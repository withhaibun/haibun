import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

import { AStepper, type IHasCycles, type IHasOptions } from "@haibun/core/lib/astepper.js";
import { allocateSyntheticSeqPath } from "@haibun/core/lib/host-id.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getFromRuntime, getStepperOption, stringOrError, errorDetail } from "@haibun/core/lib/util/index.js";
import { currentVersion as version } from "@haibun/core/currentVersion.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { buildFeatureStepForTransport, type StepRegistry, type StepTool } from "@haibun/core/lib/step-registry.js";
import { validateToolInput } from "@haibun/core/lib/tool-validation.js";
import type { IWebServer, Context } from "./defs.js";
import { WEBSERVER } from "./defs.js";
import type { IStepTransport } from "./step-transport.js";
import { grantedCapabilityForRequest, validateCapabilityAuthConfig } from "./capability-auth.js";
// --- Type Definitions ---

type StoredTool = {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
		required?: string[];
		[key: string]: unknown;
	};
	capability?: string;
	stepTool: StepTool;
	handler: (input: Record<string, unknown>, grantedCapability?: string | string[]) => Promise<CallToolResult>;
};

export default class McpStepper extends AStepper implements IHasOptions, IHasCycles, IStepTransport {
	description = "Expose all Haibun steps as callable MCP tools for LLM agents";
	readonly name = "McpStepper";

	/** IStepTransport: refresh tool registries from the shared registry. */
	attach(registry: StepRegistry, _webserver: IWebServer): void {
		this.currentRegistry = registry;
		this.populateToolRegistries(registry);
	}

	/** IStepTransport: close MCP server on teardown. */
	detach(): void {
		void this.close();
	}

	options = {
		MCP_PATH: {
			desc: "Path for MCP endpoint",
			parse: (p: string) => stringOrError(p),
		},
		ACCESS_TOKEN: {
			desc: "Access token for MCP auth",
			parse: (t: string) => stringOrError(t),
		},
		ACCESS_CAPABILITY: {
			desc: "Capability granted to callers authenticated with ACCESS_TOKEN",
			parse: (t: string) => stringOrError(t),
		},
		PORT: {
			desc: "Port to listen on (overrides WebServer default)",
			parse: (p: string) => stringOrError(p),
		},
	};

	cycles = {
		startFeature: async () => {
			this.populateToolRegistries();
			await this.setupMcp();
		},
		endFeature: async () => {
			await this.close();
		},
	};

	private mcpServer?: McpServer;
	private transport?: StreamableHTTPTransport;
	private steppers: AStepper[] = [];
	private currentRegistry?: StepRegistry;

	/** The run's registry, which the run attaches this transport to before any feature starts. */
	private registry(): StepRegistry {
		if (!this.currentRegistry) throw new Error("McpStepper: no step registry is attached");
		return this.currentRegistry;
	}

	private mcpPath = "/mcp";
	private accessToken = "";
	private accessCapability = "";

	private globalToolRegistry = new Map<string, StoredTool>();

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.mcpPath = (getStepperOption(this, "MCP_PATH", world.moduleOptions) as string) || "/mcp";
		this.accessToken = (getStepperOption(this, "ACCESS_TOKEN", world.moduleOptions) as string) || "";
		this.accessCapability = (getStepperOption(this, "ACCESS_CAPABILITY", world.moduleOptions) as string) || "";
		validateCapabilityAuthConfig("McpStepper", {
			accessToken: this.accessToken || undefined,
			accessCapability: this.accessCapability || undefined,
		});
	}

	public getTools(): Tool[] {
		return Array.from(this.globalToolRegistry.values()).map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));
	}

	public async executeTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
		const toolDef = this.globalToolRegistry.get(name);
		if (!toolDef) {
			throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found.`);
		}
		return await this.callTool(toolDef, args);
	}

	private async callTool(toolDef: StoredTool, args: Record<string, unknown>, grantedCapability?: string | string[]): Promise<CallToolResult> {
		try {
			return await toolDef.handler(args, grantedCapability);
		} catch (err: unknown) {
			const msg = errorDetail(err);
			return { isError: true, content: [{ type: "text", text: msg }] };
		}
	}

	private async setupMcp() {
		if (this.mcpServer) return;

		if (!this.accessToken) {
			throw new Error("McpStepper: ACCESS_TOKEN is required. Configure HAIBUN_O_MCPSTEPPER_ACCESS_TOKEN environment variable.");
		}

		const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
		if (!webserver) throw new Error("McpStepper: No webserver found in runtime.");

		this.mcpServer = new McpServer({ name: "haibun-mcp", version }, { capabilities: { tools: {}, resources: {} } });
		this.transport = new StreamableHTTPTransport({ enableJsonResponse: true });

		// --- HANDLER 1: LIST TOOLS ---
		// Every step is a tool. Which of them a model is given at once is its host's choice, as the MCP client best
		// practices place it; a host with no search of its own finds steps with the show steps step, which is a tool too.
		this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.getTools() }));

		// --- HANDLER 2: CALL TOOL ---
		this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
			const grantedCapability = await this.getGrantedCapability(extra);
			const toolDef = this.globalToolRegistry.get(request.params.name);
			if (!toolDef) throw new McpError(ErrorCode.MethodNotFound, `Tool ${request.params.name} not found.`);
			return await this.callTool(toolDef, (request.params.arguments as Record<string, unknown>) || {}, grantedCapability);
		});

		// --- HANDLER 3: LIST RESOURCES ---
		this.mcpServer.server.setRequestHandler(ListResourcesRequestSchema, (_request, _extra) => {
			return {
				resources: [
					{
						uri: `mcp://${this.mcpPath}/info`,
						name: "Haibun MCP Server Info",
						mimeType: "application/json",
						description: "Basic information about this MCP server",
					},
				],
			};
		});

		// --- HANDLER 4: READ RESOURCE ---
		this.mcpServer.server.setRequestHandler(ReadResourceRequestSchema, (request, _extra) => {
			if (request.params.uri === `mcp://${this.mcpPath}/info`) {
				return {
					contents: [
						{
							uri: request.params.uri,
							mimeType: "application/json",
							text: JSON.stringify({
								version,
								name: "haibun-mcp",
								status: "running",
							}),
						},
					],
				};
			}
			throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
		});

		await this.mcpServer.connect(this.transport);
		this.setupMiddleware(webserver);
		this.setupRoutes(webserver);
		this.getWorld().eventLogger.info(`🔗 MCP endpoint registered at ${this.mcpPath}`);

		// --- RESOLVE PORT (Fixed Priority) ---
		// 1. Check McpStepper options (highest priority)
		const myPortOpt = getStepperOption(this, "PORT", this.getWorld().moduleOptions);
		// 2. Check WebServerStepper options
		const wsPortOpt = (this.getWorld().moduleOptions as unknown as Record<string, Record<string, unknown> | undefined>)?.["WebServerStepper"]?.["PORT"];
		// 3. Check Environment variable
		const envPort = process.env["HAIBUN_O_WEBSERVERSTEPPER_PORT"];

		// Default to '8128' if nothing else is found.
		const rawPort = myPortOpt || wsPortOpt || envPort || "8128";
		const port = parseInt(String(rawPort), 10);

		try {
			await webserver.listen("mcp", port);
			this.getWorld().eventLogger.info(`[MCP] WebServer started on port ${port}`);
		} catch (e) {
			const estr = String(e);
			if ((e as { code?: string })?.code === "EADDRINUSE" || estr.includes("already in use")) {
				this.getWorld().eventLogger.info(`[MCP] WebServer already listening on port ${port} (shared)`);
			} else {
				const msg = `[MCP] WebServer listen failure: ${estr}`;
				this.getWorld().eventLogger.error(msg);
				throw new Error(msg);
			}
		}
	}

	/** Each step the run's registry holds is a tool, a step another host injected among them, called under its own name. */
	private populateToolRegistries(registry?: StepRegistry) {
		if (registry) this.currentRegistry = registry;
		this.globalToolRegistry.clear();
		for (const stepTool of this.registry().list()) {
			if (stepTool.stepDef?.exposeMCP === false) continue;
			// Strip metadata that can confuse some MCP clients
			const inputSchema = { ...stepTool.inputSchema };
			delete inputSchema["$schema"];
			delete inputSchema["additionalProperties"];
			const tool: StoredTool = {
				name: stepTool.name,
				description: stepTool.capability ? `${stepTool.description} Requires capability: ${stepTool.capability}.` : stepTool.description,
				inputSchema,
				capability: stepTool.capability,
				stepTool,
				handler: async (input: Record<string, unknown>, grantedCapability?: string | string[]): Promise<CallToolResult> => {
					this.getWorld().eventLogger.info(`[MCP] Tool Execution: ${stepTool.name}`);
					// MCP callers have no haibun seqPath; the server synthesises one.
					const world = this.getWorld();
					const seqPath = allocateSyntheticSeqPath(world);
					const validatedParams = validateToolInput(seqPath, stepTool, input, world);
					const featureStep = buildFeatureStepForTransport(stepTool, validatedParams, seqPath);
					const hr = await dispatchStep({ registry: this.registry(), world, steppers: this.steppers, grantedCapability }, featureStep);
					if (!hr.ok) {
						return { isError: true, content: [{ type: "text", text: hr.errorMessage ?? "Step failed" }] };
					}
					return { content: [{ type: "text", text: JSON.stringify(hr.products ?? {}, null, 2) }] };
				},
			};
			this.globalToolRegistry.set(stepTool.name, tool);
		}
	}

	private async getGrantedCapability(extra: {
		requestInfo?: { headers?: Record<string, string | string[] | undefined>; method?: string; url?: unknown } | undefined;
	}): Promise<string[] | undefined> {
		const headers = extra.requestInfo?.headers;
		if (!headers) return undefined;
		const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
		const url = extra.requestInfo?.url;
		const { granted } = await grantedCapabilityForRequest(
			{ headers: normalizedHeaders, method: extra.requestInfo?.method, url: url === undefined ? undefined : String(url) },
			this.getWorld().runtime,
			{
				accessToken: this.accessToken || undefined,
				accessCapability: this.accessCapability || undefined,
			},
		);
		return granted;
	}

	private setupMiddleware(webserver: IWebServer) {
		const applyMcpMiddleware = async (c: Context, next: () => Promise<void>) => {
			// 1. CORS
			c.header("Access-Control-Allow-Origin", "*");
			c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Custom-Header");

			if (c.req.method === "OPTIONS") return c.body(null, 204);

			// 2. Auth
			if (this.accessToken) {
				const auth = c.req.header("authorization");
				if (!auth?.startsWith("Bearer ") || auth.slice(7) !== this.accessToken) {
					return c.json({ error: "Unauthorized" }, 401);
				}
			}

			// 3. Disable Compression (Critical for SSE)
			c.header("Cache-Control", "no-transform");

			await next();
		};

		webserver.app.use(this.mcpPath, applyMcpMiddleware);
		webserver.app.use(`${this.mcpPath}/*`, applyMcpMiddleware);
	}

	private setupRoutes(webserver: IWebServer) {
		const handleMcpRequest = async (c: Context) => {
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

			const transport = this.transport;
			if (!transport) throw new Error("Transport not initialized");
			const response = await transport.handleRequest(proxyContext);

			if (!response) {
				this.getWorld().eventLogger.warn("[MCP] No response generated by transport");
				return c.notFound();
			}
			return response;
		};

		webserver.app.all(this.mcpPath, handleMcpRequest);
		webserver.app.all(`${this.mcpPath}/*`, handleMcpRequest);
	}

	async close() {
		if (this.mcpServer) await this.mcpServer.close();
		this.mcpServer = undefined;
		this.transport = undefined;
	}

	steps = {
		serveMcpTools: {
			gwta: "serve mcp tools at {path}",
			action: async ({ path }: { path: string }) => {
				this.mcpPath = String(path);
				await this.setupMcp();
				return OK;
			},
		},
	};
}
