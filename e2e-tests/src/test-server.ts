import { rmSync, writeFileSync, readFileSync } from "fs";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { setCookie } from "@haibun/web-server-hono/cookie.js";

import { actionNotOK, actionOK, actionOKWithProducts, getFromRuntime, sleep } from "@haibun/core/lib/util/index.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import type { TFeatureStep, IStepperCycles } from "@haibun/core/lib/defs.js";
import { OK, Origin, type TStepArgs, type TProvenanceIdentifier } from "@haibun/core/schema/protocol.js";
import { type TRequestHandler, type IWebServer, WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { restRoutes } from "./rest.js";
import { createDynamicAuthMiddleware, authSchemes, type TSchemeType, type AuthSchemeLogout } from "./authSchemes.js";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";

const TALLY = "tally";

const setTally = (value: number) => ({
	term: TALLY,
	value: String(value),
	domain: DOMAIN_STRING,
	origin: Origin.var,
});

async function mcpRpc(
	url: string,
	id: number,
	method: string,
	params: Record<string, unknown>,
	token: string,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
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

async function mcpListTools(url: string, token: string): Promise<Array<{ name?: string }>> {
	await mcpRpc(
		url,
		1,
		"initialize",
		{
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "haibun-e2e-client", version: "1.0" },
		},
		token,
	);
	const response = await mcpRpc(url, 2, "tools/list", {}, token);
	return (response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
}

async function mcpAccessStepper(url: string, token: string, stepperName: string): Promise<string> {
	const response = await mcpRpc(
		url,
		3,
		"tools/call",
		{
			name: `access_stepper_${stepperName}`,
			arguments: {},
		},
		token,
	);
	const text = mcpToolResult(response).content?.[0]?.type === "text" ? (mcpToolResult(response).content?.[0]?.text ?? "") : "";
	return text;
}

async function mcpCallTool(url: string, token: string, toolName: string): Promise<Record<string, unknown>> {
	return await mcpRpc(url, 4, "tools/call", { name: toolName, arguments: {} }, token);
}

const cycles = (ts: TestServer): IStepperCycles => ({
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
				webserver.addRoute(method, loc, route);
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
				webserver.addKnownRoute(method, loc, route);
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
			(parseInt(
				(await this.getWorld().shared.resolveVariable({ term: TALLY, origin: Origin.var }, undefined, undefined, { secure: true }))
					.value as string,
				10,
			) || 0) + 1;
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
			action: async () => actionOKWithProducts({ protected: true }),
		},
		protectedAdminRpcPing: {
			gwta: "protected admin rpc ping",
			capability: "TestServer:admin",
			action: async () => actionOKWithProducts({ admin: true }),
		},
		mcpStepIndexIncludes: {
			gwta: "mcp tool index at {url} includes {toolName} when bearer token is {token}",
			action: async ({ url, toolName, token }: TStepArgs) => {
				const tools = await mcpListTools(String(url), String(token));
				return tools.some((tool) => tool.name === String(toolName))
					? actionOK()
					: actionNotOK(`Expected ${String(toolName)} in MCP index [${tools.map((tool) => tool.name).join(", ")}]`);
			},
		},
		mcpStepperListingIncludes: {
			gwta: "mcp stepper {stepperName} at {url} includes tool {toolName} when bearer token is {token}",
			action: async ({ stepperName, url, toolName, token }: TStepArgs) => {
				await mcpListTools(String(url), String(token));
				const listing = await mcpAccessStepper(String(url), String(token), String(stepperName));
				return listing.includes(String(toolName))
					? actionOK()
					: actionNotOK(`Expected ${String(toolName)} in MCP stepper listing ${listing}`);
			},
		},
		mcpProtectedDeniedWithBearerToken: {
			gwta: "mcp call to {url} with tool {toolName} is denied when bearer token is {token}",
			action: async ({ url, toolName, token }: TStepArgs) => {
				await mcpListTools(String(url), String(token));
				const response = await mcpCallTool(String(url), String(token), String(toolName));
				const result = mcpToolResult(response);
				const text = result.content?.[0]?.type === "text" ? (result.content[0].text ?? "") : "";
				if (!result.isError) return actionNotOK(`Expected MCP denial, got ${JSON.stringify(response)}`);
				if (!text.includes("capability TestServer:protected required")) {
					return actionNotOK(`Expected capability denial, got ${JSON.stringify(response)}`);
				}
				return actionOK();
			},
		},
		mcpDeniedForCapabilityWithBearerToken: {
			gwta: "mcp call to {url} with tool {toolName} is denied for capability {capability} when bearer token is {token}",
			action: async ({ url, toolName, capability, token }: TStepArgs) => {
				await mcpListTools(String(url), String(token));
				const response = await mcpCallTool(String(url), String(token), String(toolName));
				const result = mcpToolResult(response);
				const text = result.content?.[0]?.type === "text" ? (result.content[0].text ?? "") : "";
				if (!result.isError) return actionNotOK(`Expected MCP denial, got ${JSON.stringify(response)}`);
				if (!text.includes(`capability ${String(capability)} required`)) {
					return actionNotOK(`Expected capability denial, got ${JSON.stringify(response)}`);
				}
				return actionOK();
			},
		},
		mcpProtectedAllowedWithBearerToken: {
			gwta: "mcp call to {url} with tool {toolName} succeeds when bearer token is {token}",
			action: async ({ url, toolName, token }: TStepArgs) => {
				await mcpListTools(String(url), String(token));
				const response = await mcpCallTool(String(url), String(token), String(toolName));
				const result = mcpToolResult(response);
				if (result.isError) return actionNotOK(`Expected MCP success, got ${JSON.stringify(response)}`);
				const text = result.content?.[0]?.type === "text" ? (result.content[0].text ?? "{}") : "{}";
				const parsed = JSON.parse(text) as { protected?: boolean };
				return parsed.protected === true ? actionOK() : actionNotOK(`Expected protected=true, got ${text}`);
			},
		},
		rpcProtectedDenied: {
			gwta: "rpc call to {url} with method {method} is denied without capability",
			action: async ({ url, method }: TStepArgs) => {
				const response = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "rpc-denied",
						method: String(method),
						params: {},
					}),
				});
				const data = (await response.json()) as Record<string, unknown>;
				if (response.status !== 422) return actionNotOK(`Expected HTTP 422, got ${response.status}`);
				if (typeof data.error !== "string" || !data.error.includes("capability TestServer:protected required")) {
					return actionNotOK(`Expected capability denial, got ${JSON.stringify(data)}`);
				}
				return actionOK();
			},
		},
		rpcProtectedAllowed: {
			gwta: "rpc call to {url} with method {method} succeeds when bearer token is {token}",
			action: async ({ url, method, token }: TStepArgs) => {
				const response = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "rpc-allowed",
						method: String(method),
						params: {},
					}),
				});
				if (!response.ok) return actionNotOK(`HTTP ${response.status}`);
				const data = (await response.json()) as Record<string, unknown>;
				if (data.error) return actionNotOK(String(data.error));
				if (data.protected !== true) return actionNotOK(`Expected protected=true, got ${JSON.stringify(data)}`);
				return actionOK();
			},
		},
		rpcProtectedDeniedWithBearerToken: {
			gwta: "rpc call to {url} with method {method} is denied when bearer token is {token}",
			action: async ({ url, method, token }: TStepArgs) => {
				const response = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "rpc-denied-token",
						method: String(method),
						params: {},
					}),
				});
				const data = (await response.json()) as Record<string, unknown>;
				if (response.status !== 422) return actionNotOK(`Expected HTTP 422, got ${response.status}`);
				if (typeof data.error !== "string" || !data.error.includes("capability TestServer:protected required")) {
					return actionNotOK(`Expected capability denial, got ${JSON.stringify(data)}`);
				}
				return actionOK();
			},
		},
		rpcDeniedForCapabilityWithBearerToken: {
			gwta: "rpc call to {url} with method {method} is denied for capability {capability} when bearer token is {token}",
			action: async ({ url, method, capability, token }: TStepArgs) => {
				const response = await fetch(String(url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${String(token)}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "rpc-denied-token",
						method: String(method),
						params: {},
					}),
				});
				const data = (await response.json()) as Record<string, unknown>;
				if (response.status !== 422) return actionNotOK(`Expected HTTP 422, got ${response.status}`);
				if (typeof data.error !== "string" || !data.error.includes(`capability ${String(capability)} required`)) {
					return actionNotOK(`Expected capability denial, got ${JSON.stringify(data)}`);
				}
				return actionOK();
			},
		},
		addTallyRoute: {
			gwta: "start tally route at {loc}",
			action: this.addRoute(this.tally),
		},
		addUploadRoute: {
			gwta: "start upload route at {loc}",
			action: (args: TStepArgs, vstep: TFeatureStep) => {
				const { loc } = args as { loc: string };
				try {
					const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
					webserver.addRoute("post", loc, this.upload);
					return actionOK();
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					this.getWorld().eventLogger.error(`Error adding upload route ${loc}: ${err.message}`);
					return actionNotOK(`${vstep.in}: ${err.message}`);
				}
			},
		},
		addDownloadRoute: {
			gwta: "start download route at {loc}",
			action: this.addRoute(this.download),
		},
		addCreateAuthTokenRoute: {
			gwta: "start create auth token route at {loc}",
			action: this.addRoute(restRoutes(this).createAuthToken),
		},
		changeServerAuthToken: {
			gwta: "change server auth token to {token}",
			action: (args: TStepArgs, _vstep: TFeatureStep) => {
				const { token } = args as { token: string };
				this.authToken = token;
				return actionOK();
			},
		},
		// Protected routes - use dynamic auth middleware
		addCheckAuthTokenRoute: {
			gwta: "start check auth route at {loc}",
			action: this.addAuthRoute(restRoutes(this).checkAuth),
		},
		addLogin: {
			gwta: "start auth login route at {loc}",
			action: this.addRoute(restRoutes(this).logIn, "post"),
		},
		addLogoutRoute: {
			gwta: "start logout auth route at {loc}",
			action: this.addRoute(restRoutes(this).logOut),
		},
		addResources: {
			gwta: "start auth resources get route at {loc}",
			action: this.addAuthRoute(restRoutes(this).resources),
		},
		addResourceGet: {
			gwta: "start auth resource get route at {loc}",
			action: this.addAuthRoute(restRoutes(this).resourceGet),
		},
		addResourceDelete: {
			gwta: "start auth resource delete route at {loc}",
			action: this.addAuthRoute(restRoutes(this).resourceDelete, "delete"),
		},
		setAuthScheme: {
			gwta: "make auth scheme {scheme}",
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
