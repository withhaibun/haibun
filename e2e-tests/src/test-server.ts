import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { rmSync, writeFileSync, readFileSync } from "fs";
import { createRequire } from "module";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { setCookie } from "@haibun/web-server-hono/cookie.js";

import { actionNotOK, actionOK, actionOKWithProducts, getFromRuntime } from "@haibun/core/lib/domains/util.js";
import { createEnumDomainDefinition, DOMAIN_BEARER_TOKEN, DOMAIN_STRING, DOMAIN_LINK, DOMAIN_TEXT, DOMAIN_STEP_METHOD, DOMAIN_ROUTE } from "@haibun/core/lib/domains/domains.js";
import { MATCHING_METHOD, SHOW_STEPS_ACTION, SHOW_STEPS_LINE, readStepSummaries } from "@haibun/core/lib/step-discovery.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import type { TFeatureStep, IStepperCycles } from "@haibun/core/lib/astepper.js";
import { OK, Origin, type TStepArgs, type TProvenanceIdentifier } from "@haibun/core/lib/domains/protocol.js";
import { WEBSERVER } from "@haibun/web-server-hono/domains/web-server.js";
import type { TRequestHandler, IWebServer } from "@haibun/web-server-hono/defs.js";
import { restRoutes } from "./rest.js";
import { createDynamicAuthMiddleware, authSchemes, type TSchemeType, type AuthSchemeLogout } from "./authSchemes.js";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { FakeInvoker, DOMAIN_FAKE_HOLDER } from "@haibun/core/lib/test/fake-authority.js";
import { TEST_DOMAIN, testDomainDefinitions } from "@haibun/core/lib/test/test-domains.js";
import { REFUSED_CALL_STATUS, REFUSED_INVOCATION, RPC_PROTOCOL } from "@haibun/core/lib/rpc-wire.js";
import { z } from "zod";
import type { TWorld } from "@haibun/core/lib/world.js";
import { DOMAIN_JSON, DOMAIN_STATEMENT } from "@haibun/core/lib/domains/domains.js";
import { RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledOf, actualityFeatureOf, formatRecordName } from "@haibun/core/lib/seq-path.js";
import { readEvery, recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { nextSeqPath, proveStep, stepperContext } from "@haibun/core/lib/step-dispatch.js";
import { streamContext, streamOver } from "@haibun/core/lib/step-stream-context.js";

/** The times a step's record states once the step ended. */
const EndedSchema = z.object({ generatedAtTime: z.string(), endedAtTime: z.string() });

const TALLY = "tally";

/** The QR code page's drawing library, from the installed `qrcanvas` package, so the page doesn't reach a CDN. */
const QRCANVAS_SCRIPT = createRequire(import.meta.url).resolve("qrcanvas/lib/qrcanvas.min.js");

const setTally = (value: number) => ({ term: TALLY, value: String(value), domain: DOMAIN_STRING, origin: Origin.var });

/** The holder that signs a call and the action that the call invokes. `post` sends the call unsigned when the signer is undefined. */
type TSigner = { holder: string; action: string } | undefined;

/** Builds an RPC message that calls `method` with empty params. The message carries the actuality id that a handshake with the origin of `url` returns. */
const rpcCall = async (url: string, id: string, method: string, params: Record<string, unknown> = {}) => ({
	protocol: RPC_PROTOCOL,
	id,
	method,
	params,
	actualityId: await actualityAt(new URL(url).origin),
});

/** Posts a JSON-RPC message to `url`. FakeInvoker signs the request when `signer` is defined. */
async function post(url: string, message: Record<string, unknown>, signer: TSigner): Promise<Response> {
	const body = JSON.stringify({ jsonrpc: "2.0", ...message });
	const headers = { "content-type": MEDIA_TYPE.json, accept: `${MEDIA_TYPE.json}, ${MEDIA_TYPE.eventStream}` };
	return fetch(url, { method: "POST", headers: signer ? await new FakeInvoker(signer.holder).sign({ method: "POST", url, headers, body }, signer.action) : headers, body });
}

async function mcpRpc(url: string, id: number, method: string, params: Record<string, unknown>, signer?: TSigner): Promise<Record<string, unknown>> {
	const response = await post(url, { id, method, params }, signer);
	if (!response.ok) throw new Error(`MCP ${method} failed: ${response.status} ${await response.text()}`);
	return (await response.json()) as Record<string, unknown>;
}

function mcpToolResult(response: Record<string, unknown>): { isError?: boolean; content?: Array<{ type?: string; text?: string }> } {
	return ((response.result as Record<string, unknown> | undefined) ?? response) as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
}

async function mcpListTools(url: string): Promise<Array<{ name?: string }>> {
	await mcpRpc(url, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "haibun-e2e-client", version: "1.0" } });
	const response = await mcpRpc(url, 2, "tools/list", {});
	return (response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
}

/** Calls the matching tool over MCP with `text` and show steps as its statement. `holder` signs the call for SHOW_STEPS_ACTION. Returns the method of each step in the response that `holder` may call. */
async function mcpShownSteps(url: string, text: string, holder: string): Promise<string[]> {
	const response = await mcpRpc(url, 3, "tools/call", { name: MATCHING_METHOD, arguments: { text, statement: SHOW_STEPS_LINE } }, { holder, action: SHOW_STEPS_ACTION });
	const returned = mcpToolResult(response).content?.[0]?.type === "text" ? (mcpToolResult(response).content?.[0]?.text ?? "") : "";
	if (!returned) throw new Error(`${MATCHING_METHOD} didn't return text: ${JSON.stringify(response)}`);
	return readStepSummaries(JSON.parse(returned)).steps.flatMap((step) => (step.callable ? [step.method] : []));
}

async function mcpCallTool(url: string, toolName: string, signer?: TSigner): Promise<Record<string, unknown>> {
	await mcpListTools(url);
	return await mcpRpc(url, 4, "tools/call", { name: toolName, arguments: {} }, signer);
}

/** Returns the text of the first content item in a tool call response. Returns an empty string when that item isn't text. */
const mcpText = (response: Record<string, unknown>): string => {
	const content = mcpToolResult(response).content?.[0];
	return content?.type === "text" ? (content.text ?? "") : "";
};

/** Returns OK when the status is REFUSED_CALL_STATUS and the error includes `capability ${capability} required`. Returns a failure with the status and the error otherwise. */
const deniedFor = (status: number, error: unknown, capability: string) =>
	status === REFUSED_CALL_STATUS && typeof error === "string" && error.includes(`capability ${capability} required`)
		? actionOK()
		: actionNotOK(`Expected a denial for ${capability}, got ${status} ${String(error)}`);

/** An authentication scheme the test server applies to its protected routes. */
const DOMAIN_AUTH_SCHEME = "test-auth-scheme";

const cycles = (ts: TestServer): IStepperCycles => ({
	getConcerns: () => ({
		domains: [
			...testDomainDefinitions,
			createEnumDomainDefinition({
				name: DOMAIN_AUTH_SCHEME,
				values: Object.keys(authSchemes),
				description: "An authentication scheme the test server applies to its protected routes",
			}),
		],
	}),
	startFeature: async () => {
		const p: TProvenanceIdentifier = { when: `${TestServer.name}.cycles.startFeature`, seq: [0] };
		await ts.getWorld().shared.set(setTally(0), p);
		ts.resources = [
			{ id: 1, name: "Ignore 1" },
			{ id: 2, name: "Include 2" },
			{ id: 3, name: "Include 3" },
		];
		ts.currentAuthScheme = undefined;
		ts.authSchemeHandler = undefined;
	},
});

/** The records of the actuality's steps that called `called`, as `Stepper.action`. */
const recordsCalling = async (world: TWorld, called: string) =>
	(await readEvery(world.shared.getStore(), { label: SEQ_PATH_LABEL })).filter((record) => record[SEQ_PATH_FIELD.called] === called);

/** The record of the step at `path` in the actuality's feature. */
const recordAt = async (world: TWorld, path: number[]) => recordOf(world.shared.getStore(), SEQ_PATH_LABEL, formatRecordName({ actuality: actualityFeatureOf(world.tag), path }));

class TestServer extends AStepper {
	description = "Adds test routes to the web server and declares capability-protected steps. Its RPC and MCP steps call steps at a URL and check each response.";
	cycles = cycles(this);
	steppers: AStepper[] = [];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}
	toDelete: { [name: string]: string } = {};

	/** The auth scheme that the dynamic auth middleware applies to protected routes. The `make auth scheme` step sets it. The middleware responds 401 without a scheme. */
	currentAuthScheme?: TSchemeType;
	/** The handler of the current auth scheme. The logout route calls its logout. */
	authSchemeHandler?: AuthSchemeLogout;
	/** Auth middleware created once. It reads currentAuthScheme on each request. */
	private dynamicAuthMiddleware?: ReturnType<typeof createDynamicAuthMiddleware>;

	authToken: string | undefined;

	basicAuthCreds: undefined | { username: string; password: string } = { username: "foo", password: "bar" };

	resources: { id: number; name: string }[] = [];

	endedFeatures() {
		if (Object.keys(this.toDelete).length > 0) {
			this.getWorld().eventLogger.info(`removing ${JSON.stringify(this.toDelete)}`);
			for (const td of Object.values(this.toDelete)) {
				rmSync(td);
			}
		}
	}

	/** Creates the dynamic auth middleware on the first call and returns it. */
	private getDynamicAuthMiddleware() {
		if (!this.dynamicAuthMiddleware) {
			this.dynamicAuthMiddleware = createDynamicAuthMiddleware(this);
		}
		return this.dynamicAuthMiddleware;
	}

	/** Returns a step action that adds `route` at `loc` without auth middleware. */
	addRoute = (route: TRequestHandler, method: "get" | "post" | "delete" = "get") => {
		return (args: TStepArgs, vstep: TFeatureStep) => {
			const { loc } = args as { loc: string };
			const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);

			try {
				webserver.addRoute(method, loc, { description: `e2e test server route ${method.toUpperCase()} ${loc}` }, route);
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.getWorld().eventLogger.error(`addRoute failed: ${err.message}`);
				return actionNotOK(`${vstep.in}: ${err.message}`);
			}
			return actionOK();
		};
	};

	/** Returns a step action that applies the dynamic auth middleware at `loc` and adds `route` there. */
	addAuthRoute = (route: TRequestHandler, method: "get" | "post" | "delete" = "get") => {
		return (args: TStepArgs, vstep: TFeatureStep) => {
			const { loc } = args as { loc: string };
			const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);

			try {
				webserver.app.use(loc, this.getDynamicAuthMiddleware());
				webserver.addRoute(method, loc, { description: `e2e test server auth-protected route ${method.toUpperCase()} ${loc}` }, route);
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.getWorld().eventLogger.error(`addAuthRoute failed: ${err.message}`);
				return actionNotOK(`${vstep.in}: ${err.message}`);
			}
			return actionOK();
		};
	};

	tally: TRequestHandler = async (c: Context): Promise<Response> => {
		const cur =
			(parseInt((await this.getWorld().shared.resolveVariable({ term: TALLY, origin: Origin.var }, undefined, undefined, { secure: true })).value as string, 10) || 0) + 1;
		await this.getWorld().shared.set(setTally(cur), { when: "tally", seq: [cur] });
		this.getWorld().eventLogger.info(`tally ${cur}`);
		const username = c.req.query("username");
		await this.getWorld().clock.wait(Math.random() * 2000);
		setCookie(c, "userid", String(username));
		return c.html(`<h1>Counter test</h1>tally: ${cur}<br />username ${username} `);
	};

	qrcanvasScript: TRequestHandler = (c: Context): Promise<Response> =>
		Promise.resolve(c.body(readFileSync(QRCANVAS_SCRIPT, "utf-8"), 200, { "Content-Type": MEDIA_TYPE.javascript }));

	download: TRequestHandler = (c: Context): Promise<Response> => {
		if (!this.toDelete.uploaded) {
			return Promise.resolve(c.text("A file hasn't been uploaded. Upload a file before downloading it.", 404));
		}

		this.toDelete.downloaded = "/tmp/test-downloaded.jpg";
		const fileBuffer = readFileSync(this.toDelete.uploaded);
		const filename = this.toDelete.uploaded.split("/").pop() ?? "download";
		return Promise.resolve(new Response(fileBuffer, { status: 200, headers: { "Content-Type": MEDIA_TYPE.bytes, "Content-Disposition": `attachment; filename="${filename}"` } }));
	};

	upload: TRequestHandler = async (c: Context): Promise<Response> => {
		const body = await c.req.parseBody();
		const uploaded = body["upload"];

		if (!uploaded || !(uploaded instanceof File)) {
			return c.text("The request didn't include a file in the upload field. Send a file in that field.", 400);
		}

		const uploadPath = `/tmp/upload-${Date.now()}.${uploaded.name}.uploaded`;
		const buffer = await uploaded.arrayBuffer();
		writeFileSync(uploadPath, Buffer.from(buffer));
		this.toDelete.uploaded = uploadPath;

		return c.html('<a id="to-download" href="/download">Uploaded file</a>');
	};

	steps: TStepperSteps = {
		protectedRpcPing: {
			gwta: "protected rpc ping",
			description: "Returns a pong of true to a caller that holds the TestServer:protected capability.",
			capability: "TestServer:protected",
			productsDomain: TEST_DOMAIN.pong,
			action: async () => actionOKWithProducts({ pong: true }),
		},
		protectedAdminRpcPing: {
			gwta: "protected admin rpc ping",
			description: "Passes a call from a caller that holds the TestServer:admin capability.",
			capability: "TestServer:admin",
			action: async () => OK,
		},
		rpcPing: {
			gwta: "rpc ping",
			description: "Returns a pong of true to a caller over RPC.",
			productsDomain: TEST_DOMAIN.pong,
			action: async () => actionOKWithProducts({ pong: true }),
		},
		mcpShownStepsInclude: {
			gwta: `mcp steps shown at {url: ${DOMAIN_LINK}} to {holder: ${DOMAIN_FAKE_HOLDER}} matching {text: ${DOMAIN_TEXT}} include {toolName: ${DOMAIN_STEP_METHOD}}`,
			description:
				"Lists the tools the MCP endpoint at the URL holds, and reads the steps the endpoint shows to the holder for the text. The methods of the steps the holder may call include the one named, and the step fails where they don't.",
			action: async ({ url, holder, text, toolName }: TStepArgs) => {
				await mcpListTools(String(url));
				const shown = await mcpShownSteps(String(url), String(text), String(holder));
				return shown.includes(String(toolName)) ? actionOK() : actionNotOK(`Expected ${String(toolName)} among the steps shown [${shown.join(", ")}]`);
			},
		},
		mcpRefused: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} without a capability invocation is refused`,
			description:
				"Calls the tool of the MCP endpoint at the URL without a capability invocation, and proves that the response's tool result is an error that holds the refusal's error text.",
			action: async ({ url, toolName }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName));
				const expected = refusal(String(toolName), undefined, undefined).error;
				return mcpToolResult(response).isError && mcpText(response) === expected ? actionOK() : actionNotOK(`Expected "${expected}", got ${JSON.stringify(response)}`);
			},
		},
		mcpDeniedSigned: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} is denied for capability {capability: ${TEST_DOMAIN.action}} when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			description:
				"Calls the tool of the MCP endpoint at the URL, signed by the holder for the action, and proves that the response's tool result is an error that denies the call for the capability named.",
			action: async ({ url, toolName, capability, holder, action }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName), { holder: String(holder), action: String(action) });
				return mcpToolResult(response).isError
					? deniedFor(REFUSED_CALL_STATUS, mcpText(response), String(capability))
					: actionNotOK(`Expected MCP denial, got ${JSON.stringify(response)}`);
			},
		},
		mcpAllowedSigned: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} succeeds when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			description:
				"Calls the tool of the MCP endpoint at the URL, signed by the holder for the action, and proves that the response's tool result succeeds and holds a pong of true.",
			action: async ({ url, toolName, holder, action }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName), { holder: String(holder), action: String(action) });
				if (mcpToolResult(response).isError) return actionNotOK(`Expected MCP success, got ${JSON.stringify(response)}`);
				const parsed = JSON.parse(mcpText(response) || "{}") as { pong?: boolean };
				return parsed.pong === true ? actionOK() : actionNotOK(`Expected the protected ping to return { pong: true }, got ${mcpText(response)}`);
			},
		},
		rpcRefused: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} without a capability invocation is refused`,
			description:
				"Calls the method over RPC at the URL without a capability invocation, and proves that the response refuses the call with the refused call's status and the refusal's error.",
			action: async ({ url, method }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-refused", String(method)), undefined);
				const error = ((await response.json()) as { error?: unknown }).error;
				const expected = refusal(String(method), undefined, undefined).error;
				return response.status === REFUSED_CALL_STATUS && error === expected
					? actionOK()
					: actionNotOK(`Expected status ${REFUSED_CALL_STATUS} with "${expected}", got ${response.status} ${String(error)}`);
			},
		},
		rpcAllowedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} succeeds when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			description: "Calls the method over RPC at the URL, signed by the holder for the action, and proves that the response is successful and its error field is unset.",
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-allowed", String(method)), { holder: String(holder), action: String(action) });
				if (!response.ok) return actionNotOK(`HTTP ${response.status}: ${await response.text()}`);
				const data = (await response.json()) as Record<string, unknown>;
				return data.error ? actionNotOK(String(data.error)) : actionOK();
			},
		},
		readLeavesNoRecord: {
			gwta: `read of {method: ${DOMAIN_STEP_METHOD}} with {params: ${DOMAIN_JSON}} over RPC at {url: ${DOMAIN_LINK}} leaves no record`,
			description: "Reads the method over RPC at the URL with the params, and proves that the records of the method hold the same count before and after the read.",
			action: async ({ method, params, url }: TStepArgs) => {
				const world = this.getWorld();
				const { stepperName, stepName } = runRegistry(world).named(String(method)).descriptor;
				const called = calledOf(stepperName, stepName);
				const before = (await recordsCalling(world, called)).length;
				const response = await post(String(url), await rpcCall(String(url), "rpc-read", String(method), params as Record<string, unknown>), undefined);
				if (!response.ok) return actionNotOK(`the read of ${String(method)} returned the status ${response.status}: ${await response.text()}`);
				const after = (await recordsCalling(world, called)).length;
				return after === before ? actionOK() : actionNotOK(`the read of ${String(method)} over RPC wrote ${after - before} records of actuality's steps`);
			},
		},
		twoCallersProve: {
			gwta: `two callers prove {statement: ${DOMAIN_STATEMENT}} at once`,
			description:
				"Proves the statement with two callers at once, and proves that the two callers' records overlap in time. A caller's failed proof, or a call that starts after the other ends, fails the step.",
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const ctx = stepperContext(world, this.steppers);
				const paths = [nextSeqPath(world, featureStep.seqPath), nextSeqPath(world, featureStep.seqPath)];
				const proved = await Promise.all(paths.map((seqPath) => proveStep(ctx, { ...itemAt(statement, 0), seqPath, isSubStep: true })));
				if (!proved.every((result) => result.ok)) return actionNotOK(`a caller's proof failed: ${proved.map((result) => result.errorMessage).join("; ")}`);
				const [first, second] = await Promise.all(paths.map((path) => recordAt(world, path)));
				const span = (record: unknown) => EndedSchema.parse(record);
				const [a, b] = [span(first), span(second)];
				const interleaved = a.generatedAtTime <= b.endedAtTime && b.generatedAtTime <= a.endedAtTime;
				return interleaved ? actionOK() : actionNotOK(`the second caller's call started at ${b.generatedAtTime}, after the first caller's call ended at ${a.endedAtTime}`);
			},
		},
		stoppedCall: {
			gwta: `call to {statement: ${DOMAIN_STATEMENT}} that its caller stops ends as stopped`,
			description:
				"Proves the statement through a stream that its caller ends, and proves that the call's record holds the stopped status. A call that ends as the other status fails the step.",
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const stopping = new AbortController();
				const stream = streamOver(() => undefined, stopping);
				stream.end("its caller left");
				const seqPath = nextSeqPath(world, featureStep.seqPath);
				const ran = await streamContext.run(stream, () => proveStep(stepperContext(world, this.steppers), { ...itemAt(statement, 0), seqPath, isSubStep: true }));
				const status = (await recordAt(world, seqPath))?.[SEQ_PATH_FIELD.actionStatus];
				return !ran.ok && status === RECORDED_STATUS.stopped ? actionOK() : actionNotOK(`the call its caller stopped ended as ${String(status)}`);
			},
		},
		rpcDeniedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is denied for capability {capability: ${TEST_DOMAIN.action}} when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			description:
				"Calls the method over RPC at the URL, signed by the holder for the action, and proves that the response denies the call for the capability named, with its status and error.",
			action: async ({ url, method, capability, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-denied", String(method)), { holder: String(holder), action: String(action) });
				return deniedFor(response.status, ((await response.json()) as { error?: unknown }).error, String(capability));
			},
		},
		rpcRefusedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is refused when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			description:
				"Calls the method over RPC at the URL, signed by the holder for the action, and proves that the response refuses the call with the status of a refused invocation.",
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-refused", String(method)), { holder: String(holder), action: String(action) });
				const data = (await response.json()) as { error?: unknown };
				return response.status === REFUSED_INVOCATION
					? actionOK()
					: actionNotOK(`Expected the server to refuse the call with status ${REFUSED_INVOCATION}, got ${response.status} ${JSON.stringify(data)}`);
			},
		},
		addTallyRoute: {
			gwta: `start tally route at {loc: ${DOMAIN_ROUTE}}`,
			description: "Adds the tally route at the location, which tallies each request it receives into a variable and responds with the tally and the username its query holds.",
			action: this.addRoute(this.tally),
		},
		addUploadRoute: {
			gwta: `start upload route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds the upload route at the location, which saves the file its request holds in the upload field to a temporary file, and responds with a link to the download route. A request without the file receives the status 400.",
			action: (args: TStepArgs, vstep: TFeatureStep) => {
				const { loc } = args as { loc: string };
				try {
					const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
					webserver.addRoute("post", loc, { description: `e2e test server upload endpoint at ${loc}` }, this.upload);
					return actionOK();
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					this.getWorld().eventLogger.error(`Error adding upload route ${loc}: ${err.message}`);
					return actionNotOK(`${vstep.in}: ${err.message}`);
				}
			},
		},
		addQrcanvasRoute: {
			gwta: `serve the qrcanvas script at {loc: ${DOMAIN_ROUTE}}`,
			description: "Adds a route at the location, which serves the drawing library of the installed qrcanvas package, so a page that draws a QR code doesn't reach a CDN.",
			action: this.addRoute(this.qrcanvasScript),
		},
		addDownloadRoute: {
			gwta: `start download route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds the download route at the location, which sends the file an upload saved as an attachment named for it, and responds to a call before an upload with the status 404.",
			action: this.addRoute(this.download),
		},
		addCreateAuthTokenRoute: {
			gwta: `start create auth token route at {loc: ${DOMAIN_ROUTE}}`,
			description: "Adds a route at the location, which responds with an access token, and sets the server's auth token to it.",
			action: this.addRoute(restRoutes(this).createAuthToken),
		},
		changeServerAuthToken: {
			gwta: `change server auth token to {token: ${DOMAIN_BEARER_TOKEN}}`,
			description: "Changes the server's auth token to the one named.",
			action: (args: TStepArgs, _vstep: TFeatureStep) => {
				const { token } = args as { token: string };
				this.authToken = token;
				return actionOK();
			},
		},
		// The check and resource steps apply the dynamic auth middleware to their routes. The login and logout steps don't.
		addCheckAuthTokenRoute: {
			gwta: `start check auth route at {loc: ${DOMAIN_ROUTE}}`,
			description: "Adds the check auth route at the location, which responds with a profile, under the dynamic auth middleware.",
			action: this.addAuthRoute(restRoutes(this).checkAuth),
		},
		addLogin: {
			gwta: `start auth login route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds the login route at the location, which responds to a request with the server's credentials by setting the server's auth token and a cookie for it, and to another with the status 401.",
			action: this.addRoute(restRoutes(this).logIn, "post"),
		},
		addLogoutRoute: {
			gwta: `start logout auth route at {loc: ${DOMAIN_ROUTE}}`,
			description: "Adds the logout route at the location, which calls the current auth scheme's logout, and redirects to the URI its query names where it holds one.",
			action: this.addAuthRoute(restRoutes(this).logOut),
		},
		addResources: {
			gwta: `start auth resources get route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds a route at the location, which responds with the server's resources, under the dynamic auth middleware. A request whose accept header holds another media type receives the status 401.",
			action: this.addAuthRoute(restRoutes(this).resources),
		},
		addResourceGet: {
			gwta: `start auth resource get route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds a route at the location, which responds with the resource the id in its path names, under the dynamic auth middleware. A request whose id names a resource the server doesn't hold receives the status 404.",
			action: this.addAuthRoute(restRoutes(this).resourceGet),
		},
		addResourceDelete: {
			gwta: `start auth resource delete route at {loc: ${DOMAIN_ROUTE}}`,
			description:
				"Adds a route at the location, which deletes the resource the id in its path names from the server's resources, under the dynamic auth middleware. A request whose id names a resource the server doesn't hold receives the status 404.",
			action: this.addAuthRoute(restRoutes(this).resourceDelete, "delete"),
		},
		setAuthScheme: {
			gwta: `make auth scheme {scheme: ${DOMAIN_AUTH_SCHEME}}`,
			description:
				"Sets the auth scheme the dynamic auth middleware applies to the server's protected routes to the one named, and holds its handler, which the logout route calls.",
			action: (args: TStepArgs, _vstep: TFeatureStep) => {
				const { scheme } = args as { scheme: string };
				this.currentAuthScheme = scheme as TSchemeType;
				this.authSchemeHandler = authSchemes[scheme as TSchemeType](this);
				return OK;
			},
		},
	};
}

export default TestServer;
