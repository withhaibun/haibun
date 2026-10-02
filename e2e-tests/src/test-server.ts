import { rmSync, writeFileSync, readFileSync } from "fs";
import { actualityAt } from "@haibun/core/lib/rpc-wire.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { setCookie } from "@haibun/web-server-hono/cookie.js";

import { actionNotOK, actionOK, actionOKWithProducts, getFromRuntime, sleep } from "@haibun/core/lib/util/index.js";
import { createEnumDomainDefinition, DOMAIN_BEARER_TOKEN, DOMAIN_STRING, DOMAIN_LINK, DOMAIN_TEXT, DOMAIN_STEP_METHOD, DOMAIN_ROUTE } from "@haibun/core/lib/domains.js";
import { SHOW_STEPS_ACTION, SHOW_STEPS_METHOD, STEP_DETAIL, readShownSteps } from "@haibun/core/lib/step-discovery.js";
import { refusal } from "@haibun/core/lib/step-registry.js";
import type { TFeatureStep, IStepperCycles } from "@haibun/core/lib/astepper.js";
import { OK, Origin, type TStepArgs, type TProvenanceIdentifier } from "@haibun/core/schema/protocol.js";
import { type TRequestHandler, type IWebServer, WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { restRoutes } from "./rest.js";
import { createDynamicAuthMiddleware, authSchemes, type TSchemeType, type AuthSchemeLogout } from "./authSchemes.js";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { FakeInvoker, DOMAIN_FAKE_HOLDER } from "@haibun/core/lib/test/fake-authority.js";
import { TEST_DOMAIN, testDomainDefinitions } from "@haibun/core/lib/test/test-domains.js";
import { REFUSED_INVOCATION, RPC_PROTOCOL } from "@haibun/core/lib/rpc-wire.js";

const TALLY = "tally";

const setTally = (value: number) => ({
	term: TALLY,
	value: String(value),
	domain: DOMAIN_STRING,
	origin: Origin.var,
});

/** Who signs a call and for which action, where a call is signed at all. */
type TSigner = { holder: string; action: string } | undefined;

/** A call of `method` at `url`, stating the actuality the host at `url` holds. */
const rpcCall = async (url: string, id: string, method: string) => ({ protocol: RPC_PROTOCOL, id, method, params: {}, actualityId: await actualityAt(new URL(url).origin) });

/** A JSON-RPC call to `url`, signed by the stand-in authority where a signer is named. */
async function post(url: string, message: Record<string, unknown>, signer: TSigner): Promise<Response> {
	const body = JSON.stringify({ jsonrpc: "2.0", ...message });
	const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
	return fetch(url, { method: "POST", headers: signer ? await new FakeInvoker(signer.holder).sign({ method: "POST", url, headers, body }, signer.action) : headers, body });
}

async function mcpRpc(url: string, id: number, method: string, params: Record<string, unknown>, signer?: TSigner): Promise<Record<string, unknown>> {
	const response = await post(url, { id, method, params }, signer);
	if (!response.ok) throw new Error(`MCP ${method} failed: ${response.status} ${await response.text()}`);
	return (await response.json()) as Record<string, unknown>;
}

function mcpToolResult(response: Record<string, unknown>): {
	isError?: boolean;
	content?: Array<{ type?: string; text?: string }>;
} {
	return ((response.result as Record<string, unknown> | undefined) ?? response) as {
		isError?: boolean;
		content?: Array<{ type?: string; text?: string }>;
	};
}

async function mcpListTools(url: string): Promise<Array<{ name?: string }>> {
	await mcpRpc(url, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "haibun-e2e-client", version: "1.0" } });
	const response = await mcpRpc(url, 2, "tools/list", {});
	return (response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
}

/** The steps shown for `text` over MCP to `holder`, which signs for the public read showing them requires. */
async function mcpShownSteps(url: string, text: string, holder: string): Promise<string[]> {
	const response = await mcpRpc(url, 3, "tools/call", { name: SHOW_STEPS_METHOD, arguments: { text, detail: STEP_DETAIL.summary } }, { holder, action: SHOW_STEPS_ACTION });
	const returned = mcpToolResult(response).content?.[0]?.type === "text" ? (mcpToolResult(response).content?.[0]?.text ?? "") : "";
	if (!returned) throw new Error(`${SHOW_STEPS_METHOD} returned nothing: ${JSON.stringify(response)}`);
	return readShownSteps(JSON.parse(returned), STEP_DETAIL.summary).steps.map((step) => step.method);
}

async function mcpCallTool(url: string, toolName: string, signer?: TSigner): Promise<Record<string, unknown>> {
	await mcpListTools(url);
	return await mcpRpc(url, 4, "tools/call", { name: toolName, arguments: {} }, signer);
}

/** What a tool call answered, as text. */
const mcpText = (response: Record<string, unknown>): string => {
	const content = mcpToolResult(response).content?.[0];
	return content?.type === "text" ? (content.text ?? "") : "";
};

/** A call denied for want of `capability`, or the reason it wasn't. */
const deniedFor = (status: number, error: unknown, capability: string) =>
	status === 422 && typeof error === "string" && error.includes(`capability ${capability} required`)
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
	startFeature: () => {
		const p: TProvenanceIdentifier = { when: `${TestServer.name}.cycles.startFeature`, seq: [0] };
		ts.getWorld().shared.set(setTally(0), p);
		ts.resources = [
			{ id: 1, name: "Ignore 1" },
			{ id: 2, name: "Include 2" },
			{ id: 3, name: "Include 3" },
		];
		// Reset auth state for each feature
		ts.currentAuthScheme = undefined;
		ts.authSchemeHandler = undefined;
	},
});

class TestServer extends AStepper {
	description = "Serves the pages, routes and protected calls the e2e features test, and checks RPC and MCP calls against them.";
	cycles = cycles(this);
	toDelete: { [name: string]: string } = {};

	/** Currently active auth scheme type - set at runtime */
	currentAuthScheme?: TSchemeType;
	/** Current auth scheme handler for logout */
	authSchemeHandler?: AuthSchemeLogout;
	/** Dynamic auth middleware - created once, checks scheme at request time */
	private dynamicAuthMiddleware?: ReturnType<typeof createDynamicAuthMiddleware>;

	authToken: string | undefined;

	basicAuthCreds: undefined | { username: string; password: string } = {
		username: "foo",
		password: "bar",
	};

	resources: { id: number; name: string }[] = [];

	endedFeatures() {
		if (Object.keys(this.toDelete).length > 0) {
			this.getWorld().eventLogger.info(`removing ${JSON.stringify(this.toDelete)}`);
			for (const td of Object.values(this.toDelete)) {
				rmSync(td);
			}
		}
	}

	/**
	 * Get or create the dynamic auth middleware.
	 * This middleware checks currentAuthScheme at request time.
	 */
	private getDynamicAuthMiddleware() {
		if (!this.dynamicAuthMiddleware) {
			this.dynamicAuthMiddleware = createDynamicAuthMiddleware(this);
		}
		return this.dynamicAuthMiddleware;
	}

	/**
	 * Add a route without auth middleware
	 */
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

	/**
	 * Add a route protected by auth middleware.
	 * Uses dynamic middleware that checks currentAuthScheme at request time.
	 */
	addAuthRoute = (route: TRequestHandler, method: "get" | "post" | "delete" = "get") => {
		return (args: TStepArgs, vstep: TFeatureStep) => {
			const { loc } = args as { loc: string };
			const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);

			try {
				// Apply dynamic auth middleware that checks scheme at request time
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
		this.getWorld().shared.set(setTally(cur), { when: "tally", seq: [cur] });
		this.getWorld().eventLogger.info(`tally ${cur}`);
		const username = c.req.query("username");
		await sleep(Math.random() * 2000);
		setCookie(c, "userid", String(username));
		return c.html(`<h1>Counter test</h1>tally: ${cur}<br />username ${username} `);
	};

	download: TRequestHandler = (c: Context): Promise<Response> => {
		if (!this.toDelete.uploaded) {
			return Promise.resolve(c.text("no file to download", 404));
		}

		this.toDelete.downloaded = "/tmp/test-downloaded.jpg";
		const fileBuffer = readFileSync(this.toDelete.uploaded);
		const filename = this.toDelete.uploaded.split("/").pop() ?? "download";
		return Promise.resolve(
			new Response(fileBuffer, {
				status: 200,
				headers: {
					"Content-Type": "application/octet-stream",
					"Content-Disposition": `attachment; filename="${filename}"`,
				},
			}),
		);
	};

	upload: TRequestHandler = async (c: Context): Promise<Response> => {
		const body = await c.req.parseBody();
		const uploaded = body["upload"];

		if (!uploaded || !(uploaded instanceof File)) {
			return c.text("No files were uploaded.", 400);
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
			capability: "TestServer:protected",
			productsDomain: TEST_DOMAIN.pong,
			action: async () => actionOKWithProducts({ pong: true }),
		},
		protectedAdminRpcPing: {
			gwta: "protected admin rpc ping",
			capability: "TestServer:admin",
			action: async () => OK,
		},
		rpcPing: {
			gwta: "rpc ping",
			productsDomain: TEST_DOMAIN.pong,
			action: async () => actionOKWithProducts({ pong: true }),
		},
		mcpShownStepsInclude: {
			gwta: `mcp steps shown at {url: ${DOMAIN_LINK}} to {holder: ${DOMAIN_FAKE_HOLDER}} matching {text: ${DOMAIN_TEXT}} include {toolName: ${DOMAIN_STEP_METHOD}}`,
			action: async ({ url, holder, text, toolName }: TStepArgs) => {
				await mcpListTools(String(url));
				const shown = await mcpShownSteps(String(url), String(text), String(holder));
				return shown.includes(String(toolName)) ? actionOK() : actionNotOK(`Expected ${String(toolName)} among the steps shown [${shown.join(", ")}]`);
			},
		},
		mcpRefused: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} presenting nothing is refused`,
			action: async ({ url, toolName }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName));
				const expected = refusal(String(toolName), undefined, undefined);
				return mcpToolResult(response).isError && mcpText(response) === expected ? actionOK() : actionNotOK(`Expected "${expected}", got ${JSON.stringify(response)}`);
			},
		},
		mcpDeniedSigned: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} is denied for capability {capability: ${TEST_DOMAIN.action}} when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, toolName, capability, holder, action }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName), { holder: String(holder), action: String(action) });
				return mcpToolResult(response).isError ? deniedFor(422, mcpText(response), String(capability)) : actionNotOK(`Expected MCP denial, got ${JSON.stringify(response)}`);
			},
		},
		mcpAllowedSigned: {
			gwta: `mcp call to {url: ${DOMAIN_LINK}} with tool {toolName: ${DOMAIN_STEP_METHOD}} succeeds when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, toolName, holder, action }: TStepArgs) => {
				const response = await mcpCallTool(String(url), String(toolName), { holder: String(holder), action: String(action) });
				if (mcpToolResult(response).isError) return actionNotOK(`Expected MCP success, got ${JSON.stringify(response)}`);
				const parsed = JSON.parse(mcpText(response) || "{}") as { pong?: boolean };
				return parsed.pong === true ? actionOK() : actionNotOK(`Expected the protected ping answered, got ${mcpText(response)}`);
			},
		},
		rpcRefused: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} presenting nothing is refused`,
			action: async ({ url, method }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-refused", String(method)), undefined);
				const error = ((await response.json()) as { error?: unknown }).error;
				const expected = refusal(String(method), undefined, undefined);
				return response.status === 422 && error === expected ? actionOK() : actionNotOK(`Expected "${expected}", got ${response.status} ${String(error)}`);
			},
		},
		rpcAllowedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} succeeds when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-allowed", String(method)), { holder: String(holder), action: String(action) });
				if (!response.ok) return actionNotOK(`HTTP ${response.status}: ${await response.text()}`);
				const data = (await response.json()) as Record<string, unknown>;
				return data.error ? actionNotOK(String(data.error)) : actionOK();
			},
		},
		rpcDeniedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is denied for capability {capability: ${TEST_DOMAIN.action}} when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, capability, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-denied", String(method)), { holder: String(holder), action: String(action) });
				return deniedFor(response.status, ((await response.json()) as { error?: unknown }).error, String(capability));
			},
		},
		rpcRefusedSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is refused when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const response = await post(String(url), await rpcCall(String(url), "rpc-refused", String(method)), { holder: String(holder), action: String(action) });
				const data = (await response.json()) as { error?: unknown };
				return response.status === REFUSED_INVOCATION
					? actionOK()
					: actionNotOK(`Expected the call refused with ${REFUSED_INVOCATION}, got ${response.status} ${JSON.stringify(data)}`);
			},
		},
		addTallyRoute: {
			gwta: `start tally route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addRoute(this.tally),
		},
		addUploadRoute: {
			gwta: `start upload route at {loc: ${DOMAIN_ROUTE}}`,
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
		addDownloadRoute: {
			gwta: `start download route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addRoute(this.download),
		},
		addCreateAuthTokenRoute: {
			gwta: `start create auth token route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addRoute(restRoutes(this).createAuthToken),
		},
		changeServerAuthToken: {
			gwta: `change server auth token to {token: ${DOMAIN_BEARER_TOKEN}}`,
			action: (args: TStepArgs, _vstep: TFeatureStep) => {
				const { token } = args as { token: string };
				this.authToken = token;
				return actionOK();
			},
		},
		// Protected routes - use dynamic auth middleware
		addCheckAuthTokenRoute: {
			gwta: `start check auth route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addAuthRoute(restRoutes(this).checkAuth),
		},
		addLogin: {
			gwta: `start auth login route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addRoute(restRoutes(this).logIn, "post"),
		},
		addLogoutRoute: {
			gwta: `start logout auth route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addRoute(restRoutes(this).logOut),
		},
		addResources: {
			gwta: `start auth resources get route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addAuthRoute(restRoutes(this).resources),
		},
		addResourceGet: {
			gwta: `start auth resource get route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addAuthRoute(restRoutes(this).resourceGet),
		},
		addResourceDelete: {
			gwta: `start auth resource delete route at {loc: ${DOMAIN_ROUTE}}`,
			action: this.addAuthRoute(restRoutes(this).resourceDelete, "delete"),
		},
		setAuthScheme: {
			gwta: `make auth scheme {scheme: ${DOMAIN_AUTH_SCHEME}}`,
			action: (args: TStepArgs, _vstep: TFeatureStep) => {
				const { scheme } = args as { scheme: string };
				// Set the current scheme - this is checked at request time by dynamic middleware
				this.currentAuthScheme = scheme as TSchemeType;
				this.authSchemeHandler = authSchemes[scheme as TSchemeType](this);
				return OK;
			},
		},
	};
}

export default TestServer;
