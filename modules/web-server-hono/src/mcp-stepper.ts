import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { answeredFor } from "@haibun/core/lib/call-step.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ErrorCode,
	McpError,
	type Tool,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { allocateSyntheticSeqPath } from "@haibun/core/lib/host-id.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getFromRuntime, getStepperOption, getStepperOptionName, stringOrError, errorDetail } from "@haibun/core/lib/util/index.js";
import { currentVersion as version } from "@haibun/core/currentVersion.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { buildFeatureStepForTransport, refusal, type StepRegistry } from "@haibun/core/lib/step-registry.js";
import { lackedAction, mayCall } from "@haibun/core/lib/actions.js";
import { stepsInstructions, toolDefinition } from "@haibun/core/lib/step-discovery.js";
import { validateToolInput } from "@haibun/core/lib/tool-validation.js";
import type { IWebServer, Context } from "./defs.js";
import { WEBSERVER } from "./defs.js";
import { ServerHono } from "./server-hono.js";
import WebServerStepper from "./web-server-stepper.js";
import type { IStepTransport } from "./step-transport.js";
import { delegateOf, grantedCapabilityForRequest, PRESENTED_REQUEST_HEADERS, refuseInvocation } from "./capability-auth.js";
import { actingAs, authorizedWith, restingOn, runActingAs, runAuthorizedWith, shownTo } from "@haibun/core/lib/capability-context.js";
import { DOMAIN_ROUTE } from "@haibun/core/lib/domains.js";
/** The port the MCP endpoint listens on where neither it nor the web server states one. */
const DEFAULT_MCP_PORT = 8128;

export default class McpStepper extends AStepper implements IHasOptions, IHasCycles, IStepTransport {
	description = "Expose all Haibun steps as callable MCP tools for LLM agents";
	readonly name = "McpStepper";

	/** IStepTransport: list actuality's registry. A caller that keeps a stream open is told each time its steps change. */
	attach(registry: StepRegistry, _webserver: IWebServer): void {
		this.currentRegistry = registry;
	}

	/** IStepTransport: stop serving on teardown. */
	detach(): void {
		this.close();
	}

	options = {
		MCP_PATH: { desc: "Path for MCP endpoint", parse: (p: string) => stringOrError(p) },
		PORT: { desc: "Port to listen on (overrides WebServer default)", parse: (p: string) => stringOrError(p) },
	};

	cycles = {
		startFeature: async () => {
			await this.setupMcp();
		},
		endFeature: () => Promise.resolve(this.close()),
	};

	/** Whether this feature's web server has the MCP routes. */
	private serving = false;
	private steppers: AStepper[] = [];
	private currentRegistry?: StepRegistry;

	/** Actuality's registry, which actuality attaches this transport to before any feature starts. */
	private registry(): StepRegistry {
		if (!this.currentRegistry) throw new Error("McpStepper: a step registry isn't attached");
		return this.currentRegistry;
	}

	private mcpPath = "/mcp";

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.mcpPath = (getStepperOption(this, "MCP_PATH", world.moduleOptions) as string) || "/mcp";
	}

	/** The steps the caller holds, as tools, a step another host injected among them. */
	public getTools(): Tool[] {
		return this.registry().heldBy(shownTo()).map(toolDefinition);
	}

	/** Call a step by its method, as a tool call names it, under the capability the caller was granted and as whoever it
	 *  proved to be. */
	public async executeTool(name: string, args: Record<string, unknown>, grantedCapability?: string | string[], principal?: string): Promise<CallToolResult> {
		const tool = this.registry().get(name);
		// A call is refused before its input is read, and alike whether its step exists, as it is over RPC.
		if (!tool || !mayCall(grantedCapability, tool.descriptor))
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: refusal(name, tool && lackedAction(grantedCapability, tool.descriptor), delegateOf({ granted: [grantedCapability ?? []].flat(), principal }, this.webserver())),
					},
				],
			};
		try {
			const world = this.getWorld();
			// MCP callers don't have a haibun seqPath; the server synthesises one.
			const seqPath = allocateSyntheticSeqPath(world);
			const featureStep = buildFeatureStepForTransport(tool, validateToolInput(seqPath, tool, args, world), seqPath);
			// A caller holds only what it presented, not what the step that started this server held.
			const result = await runActingAs(
				principal,
				async () => {
					// A model reads what its call changed next, so a call whose step names the read that answers it is answered with it.
					const dispatched = { registry: this.registry(), world, steppers: this.steppers, grantedCapability: grantedCapability ?? [] };
					return answeredFor(dispatched, tool, await dispatchStep(dispatched, featureStep));
				},
				restingOn(),
			);
			if (!result.ok) return { isError: true, content: [{ type: "text", text: result.errorMessage ?? "Step failed" }] };
			return { content: [{ type: "text", text: JSON.stringify(result.products ?? {}, null, 2) }] };
		} catch (err: unknown) {
			return { isError: true, content: [{ type: "text", text: errorDetail(err) }] };
		}
	}

	/**
	 * The server one request is answered by. A server and its transport hold the requests in flight by the id each caller
	 * chose, so one shared by callers answers one caller's request with another's result where both chose one id. Each
	 * request has its own, as the MCP SDK's stateless server does, and a caller's session is the requests it signs.
	 */
	private newMcpServer(): McpServer {
		// A host places a server's instructions in its model's context. They are set before a caller's steps are read, so they
		// don't name a stepper: a caller finds the steps it holds in the tool list and by discovery.
		const mcpServer = new McpServer({ name: "haibun-mcp", version }, { capabilities: { tools: { listChanged: true }, resources: {} }, instructions: stepsInstructions([]) });

		// --- HANDLER 1: LIST TOOLS ---
		// Each step the caller holds is a tool. Which of them a model is given at once is its host's choice, as the MCP client
		// best practices place it; a host without a search of its own finds steps with the show steps step, which is a tool too.
		mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.getTools() }));

		// --- HANDLER 2: CALL TOOL ---
		// A call runs under what its request presented, which the middleware verified over the whole request.
		mcpServer.server.setRequestHandler(CallToolRequestSchema, (request) => this.executeTool(request.params.name, request.params.arguments ?? {}, authorizedWith(), actingAs()));

		// --- HANDLER 3: LIST RESOURCES ---
		mcpServer.server.setRequestHandler(ListResourcesRequestSchema, (_request, _extra) => {
			return {
				resources: [{ uri: `mcp://${this.mcpPath}/info`, name: "Haibun MCP Server Info", mimeType: "application/json", description: "Basic information about this MCP server" }],
			};
		});

		// --- HANDLER 4: READ RESOURCE ---
		mcpServer.server.setRequestHandler(ReadResourceRequestSchema, (request, _extra) => {
			if (request.params.uri === `mcp://${this.mcpPath}/info`) {
				return { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify({ version, name: "haibun-mcp", status: "running" }) }] };
			}
			throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
		});
		return mcpServer;
	}

	private webserver(): IWebServer {
		const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
		if (!webserver) throw new Error("McpStepper: the runtime doesn't hold a webserver.");
		return webserver;
	}

	private async setupMcp() {
		if (this.serving) return;
		const webserver = this.webserver();
		this.serving = true;
		this.setupMiddleware(webserver);
		this.setupRoutes(webserver);
		this.getWorld().eventLogger.info(`🔗 MCP endpoint registered at ${this.mcpPath}`);

		// The endpoint listens on its own PORT, else on the web server's PORT, which it then shares, else on its default.
		const { moduleOptions } = this.getWorld();
		const port = Number(getStepperOption(this, "PORT", moduleOptions) || moduleOptions[getStepperOptionName(WebServerStepper, "PORT")] || DEFAULT_MCP_PORT);
		if (ServerHono.listeningPorts.has(port)) {
			this.getWorld().eventLogger.info(`[MCP] WebServer already listening on port ${port} (shared)`);
			return;
		}
		await webserver.listen("mcp", port);
		this.getWorld().eventLogger.info(`[MCP] WebServer started on port ${port}`);
	}

	private setupMiddleware(webserver: IWebServer) {
		const applyMcpMiddleware = async (c: Context, next: () => Promise<void>) => {
			// 1. CORS
			c.header("Access-Control-Allow-Origin", "*");
			c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			c.header("Access-Control-Allow-Headers", ["content-type", "accept", ...PRESENTED_REQUEST_HEADERS].join(", "));

			if (c.req.method === "OPTIONS") return c.body(null, 204);

			// 2. Auth. What the request presents is verified over the whole request, the body its digest covers included, and
			// every call it carries runs under that and what the deployment allows without a delegation, and only those: the
			// server was started inside a step of actuality, and a caller doesn't hold what that step held.
			const body = c.req.method === "POST" ? await c.req.raw.clone().text() : undefined;
			const { granted, principal, refused, restsOn } = await grantedCapabilityForRequest(
				{ method: c.req.method, url: c.req.url, headers: c.req.header(), body },
				this.getWorld().runtime,
				webserver,
			);
			if (refused) return refuseInvocation(c, refused);

			// 3. Disable Compression (Critical for SSE)
			c.header("Cache-Control", "no-transform");

			await runAuthorizedWith(granted, () => runActingAs(principal, next, restsOn));
		};

		webserver.app.use(this.mcpPath, applyMcpMiddleware);
		webserver.app.use(`${this.mcpPath}/*`, applyMcpMiddleware);
	}

	private setupRoutes(webserver: IWebServer) {
		const handleMcpRequest = async (c: Context) => {
			if (c.req.method !== "POST" && c.req.method !== "GET") return c.body(null, 405, { Allow: "GET, POST" });
			const strictAccept = "application/json, text/event-stream";
			const newHeaders = new Headers(c.req.raw.headers);

			// Ensure the transport always sees a valid Accept header
			if (!newHeaders.has("Accept")) {
				newHeaders.set("Accept", strictAccept);
			}

			// 1. CLONE OR PROXY THE RAW REQUEST
			// For GET requests, this constructs a new Request object.
			// For non-GET (POST), this MUST avoid the Request constructor as it doesn't reuse the body.
			// Instead, the raw request is proxied to intercept header access.
			const cleanRawRequest =
				c.req.method === "GET"
					? new Request(c.req.raw, { headers: newHeaders } as RequestInit)
					: new Proxy(c.req.raw, {
							get(target, prop) {
								if (prop === "headers") return newHeaders;
								const val = Reflect.get(target, prop);
								return typeof val === "function" ? val.bind(target) : val;
							},
						});

			// 2. CREATE A PROXY FOR THE CONTEXT
			// All functions must be bound to the original target to avoid
			// TypeError: Cannot read private member #cachedBody
			const proxyContext = new Proxy(c, {
				get(target, prop) {
					if (prop === "req") {
						return new Proxy(target.req, {
							get(reqTarget, reqProp) {
								// A. Intercept raw request access
								if (reqProp === "raw") return cleanRawRequest;

								// B. Intercept Hono's header() helper
								if (reqProp === "header") {
									return (name?: string) => {
										// Case 1: c.req.header('accept') -> return string
										if (name) return newHeaders.get(name);

										// Case 2: c.req.header() -> return Record<string, string>
										const all: Record<string, string> = {};
										newHeaders.forEach((v, k) => {
											all[k] = v;
										});
										return all;
									};
								}

								// C. Pass through everything else, binding functions to avoid private member issues
								const val = Reflect.get(reqTarget, reqProp);
								return typeof val === "function" ? (val as (...args: unknown[]) => unknown).bind(reqTarget) : val;
							},
						});
					}
					const val = Reflect.get(target, prop);
					return typeof val === "function" ? (val as (...args: unknown[]) => unknown).bind(target) : val;
				},
			});

			const mcpServer = this.newMcpServer();
			const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
			await mcpServer.connect(transport);
			if (c.req.method === "GET") {
				// A stream its caller holds open is told each time the steps change, until the caller closes it.
				const stopListening = this.registry().onChange(() => {
					void mcpServer.server.sendToolListChanged().catch((err: unknown) => this.getWorld().eventLogger.warn(`[MCP] the tool list change was not sent: ${errorDetail(err)}`));
				});
				c.req.raw.signal.addEventListener("abort", () => (stopListening(), void mcpServer.close()), { once: true });
				return transport.handleRequest(proxyContext);
			}
			try {
				const response = await transport.handleRequest(proxyContext);
				if (!response) throw new Error("[MCP] the transport didn't answer the request");
				return response;
			} finally {
				await mcpServer.close();
			}
		};

		webserver.app.all(this.mcpPath, handleMcpRequest);
		webserver.app.all(`${this.mcpPath}/*`, handleMcpRequest);
	}

	close(): void {
		this.serving = false;
	}

	steps = {
		serveMcpTools: {
			gwta: `serve mcp tools at {path: ${DOMAIN_ROUTE}}`,
			action: async ({ path }: { path: string }) => {
				this.mcpPath = String(path);
				await this.setupMcp();
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}
