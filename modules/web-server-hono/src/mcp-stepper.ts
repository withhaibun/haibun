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

import {
	AStepper,
	type IHasCycles,
	type IHasOptions,
} from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/defs.js";
import { OK } from "@haibun/core/schema/protocol.js";
import {
	getFromRuntime,
	getStepperOption,
	constructorName,
	stringOrError,
} from "@haibun/core/lib/util/index.js";
import { currentVersion as version } from "@haibun/core/currentVersion.js";
import {
	buildStepRegistry,
	dispatchRemoteToolCall,
	type StepRegistry,
	type StepTool,
} from "@haibun/core/lib/step-dispatch.js";
import type { IWebServer, Context } from "./defs.js";
import { WEBSERVER } from "./defs.js";
import type { IStepTransport } from "./step-transport.js";
import {
	getGrantedCapabilityFromHeaders,
	validateCapabilityAuthConfig,
} from "./capability-auth.js";

// --- Type Definitions ---

type StoredTool = {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties?: Record<
			string,
			{ type?: string; description?: string; [key: string]: unknown }
		>;
		required?: string[];
		[key: string]: unknown;
	};
	stepperName: string;
	capability?: string;
	stepTool: StepTool;
	handler: (input: Record<string, unknown>, grantedCapability?: string | string[]) => Promise<CallToolResult>;
};

type ConnectionId = object;

export default class McpStepper
	extends AStepper
	implements IHasOptions, IHasCycles, IStepTransport
{
	description = "Expose all Haibun steps as callable MCP tools for LLM agents";
	readonly name = "McpStepper";

	/** IStepTransport: refresh tool registries from the shared registry. */
	attach(registry: StepRegistry, _webserver: IWebServer): void {
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
			await this.setupMcp();
		},
		endFeature: async () => {
			await this.close();
		},
	};

	private mcpServer?: McpServer;
	private transport?: StreamableHTTPTransport;
	private steppers: AStepper[] = [];

	private mcpPath = "/mcp";
	private accessToken = "";
	private accessCapability = "";

	private globalToolRegistry = new Map<string, StoredTool>();
	private stepperToolRegistry = new Map<string, StoredTool[]>();
	private indexTools: Tool[] = [];
	// Sessions are identified by string (token/id) or connection object
	private sessionScopes = new Map<string | ConnectionId, string>();

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.mcpPath =
			(getStepperOption(this, "MCP_PATH", world.moduleOptions) as string) ||
			"/mcp";
		this.accessToken =
			(getStepperOption(this, "ACCESS_TOKEN", world.moduleOptions) as string) ||
			"";
		this.accessCapability =
			(getStepperOption(this, "ACCESS_CAPABILITY", world.moduleOptions) as string) ||
			"";
		validateCapabilityAuthConfig("McpStepper", {
			accessToken: this.accessToken || undefined,
			accessCapability: this.accessCapability || undefined,
		});
		this.populateToolRegistries();
	}

	public getTools(): Tool[] {
		return Array.from(this.globalToolRegistry.values()).map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));
	}

	public async executeTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const toolDef = this.globalToolRegistry.get(name);
		if (!toolDef) {
			throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found.`);
		}
		return await this.callTool(toolDef, args);
	}

	private async callTool(
		toolDef: StoredTool,
		args: Record<string, unknown>,
		grantedCapability?: string | string[],
	): Promise<CallToolResult> {
		try {
			return await toolDef.handler(args, grantedCapability);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { isError: true, content: [{ type: "text", text: msg }] };
		}
	}

	private async setupMcp() {
		if (this.mcpServer) return;

		if (!this.accessToken) {
			throw new Error(
				"McpStepper: ACCESS_TOKEN is required. Configure HAIBUN_O_MCPSTEPPER_ACCESS_TOKEN environment variable.",
			);
		}

		const webserver = getFromRuntime(
			this.getWorld().runtime,
			WEBSERVER,
		) as IWebServer;
		if (!webserver)
			throw new Error("McpStepper: No webserver found in runtime.");

		this.mcpServer = new McpServer(
			{ name: "haibun-mcp", version },
			{ capabilities: { tools: {}, resources: {} } },
		);
		this.transport = new StreamableHTTPTransport({ enableJsonResponse: true });

		this.indexTools = this.buildIndexTools();
		// Registry is now populated in setWorld

		// --- HANDLER 1: LIST TOOLS ---
		this.mcpServer.server.setRequestHandler(
			ListToolsRequestSchema,
			(_request, extra) => {
				const connection = (extra as { connection?: ConnectionId })?.connection;
				const sessionId = this.getSessionId(connection, extra);

				const activeStepper = sessionId
					? this.sessionScopes.get(sessionId)
					: undefined;

				if (!activeStepper) {
					return { tools: this.indexTools };
				}

				const stepperTools = this.stepperToolRegistry.get(activeStepper) || [];
				const visibleTools: Tool[] = stepperTools.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				}));

				visibleTools.unshift({
					name: "return_to_index",
					description:
						"Close current stepper tools and return to the main index of available steppers.",
					inputSchema: { type: "object", properties: {} },
				});

				return { tools: visibleTools };
			},
		);

		// --- HANDLER 2: CALL TOOL ---
		const defaultConnection = {};
		this.mcpServer.server.setRequestHandler(
			CallToolRequestSchema,
			async (request, extra) => {
				const grantedCapability = this.getGrantedCapability(extra);
				const connection =
					(extra as { connection?: ConnectionId })?.connection ||
					defaultConnection;
				const sessionId = this.getSessionId(connection, extra);

				const toolName = request.params.name;
				const args =
					(request.params.arguments as Record<string, unknown>) || {};

				if (toolName.startsWith("access_stepper_")) {
					const targetStepper = toolName.replace("access_stepper_", "");
					const stepperTools = this.stepperToolRegistry.get(targetStepper);
					if (stepperTools) {
						await this.updateSessionFocus(sessionId, targetStepper);
						const toolList = stepperTools
							.map(
								(t) =>
									`- **${t.name}**: ${t.description}\n  Schema: ${JSON.stringify(t.inputSchema)}`,
							)
							.join("\n");
						return {
							content: [
								{
									type: "text",
									text: `Tools for ${targetStepper}:\n${toolList}`,
								},
							],
						};
					}
				}

				if (toolName === "call_step") {
					const stepName = args["tool"] as string;
					const stepArgs = (args["arguments"] as Record<string, unknown>) || {};
					if (!stepName) {
						throw new McpError(
							ErrorCode.InvalidParams,
							'Missing required "tool" parameter. Use access_stepper_* to list available tools.',
						);
					}
					const toolDef = this.globalToolRegistry.get(stepName);
					if (!toolDef) {
						throw new McpError(
							ErrorCode.MethodNotFound,
							`Tool "${stepName}" not found. Use access_stepper_* to list available tools.`,
						);
					}
					return await this.callTool(toolDef, stepArgs, grantedCapability);
				}

				if (toolName === "return_to_index") {
					await this.updateSessionFocus(sessionId, undefined);
					return { content: [{ type: "text", text: `Returned to index.` }] };
				}

				const toolDef = this.globalToolRegistry.get(toolName);
				if (!toolDef) {
					throw new McpError(
						ErrorCode.MethodNotFound,
						`Tool ${toolName} not found.`,
					);
				}

				const currentFocus = this.sessionScopes.get(sessionId);
				if (toolDef.stepperName !== currentFocus) {
					this.getWorld().eventLogger.info(
						`[MCP] Auto-switching focus: ${currentFocus || "Index"} -> ${toolDef.stepperName}`,
					);
					await this.updateSessionFocus(sessionId, toolDef.stepperName);
				}

				return await this.callTool(toolDef, args, grantedCapability);
			},
		);

		// --- HANDLER 3: LIST RESOURCES ---
		this.mcpServer.server.setRequestHandler(
			ListResourcesRequestSchema,
			(_request, _extra) => {
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
			},
		);

		// --- HANDLER 4: READ RESOURCE ---
		this.mcpServer.server.setRequestHandler(
			ReadResourceRequestSchema,
			(request, _extra) => {
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
				throw new McpError(
					ErrorCode.InvalidRequest,
					`Resource not found: ${request.params.uri}`,
				);
			},
		);

		await this.mcpServer.connect(this.transport);
		this.setupMiddleware(webserver);
		this.setupRoutes(webserver);
		this.getWorld().eventLogger.info(
			`🔗 MCP endpoint registered at ${this.mcpPath}`,
		);

		// --- RESOLVE PORT (Fixed Priority) ---
		// 1. Check McpStepper options (highest priority)
		const myPortOpt = getStepperOption(
			this,
			"PORT",
			this.getWorld().moduleOptions,
		);
		// 2. Check WebServerStepper options
		const wsPortOpt = (
			this.getWorld().moduleOptions as unknown as Record<
				string,
				Record<string, unknown> | undefined
			>
		)?.["WebServerStepper"]?.["PORT"];
		// 3. Check Environment variable
		const envPort = process.env["HAIBUN_O_WEBSERVERSTEPPER_PORT"];

		// Default to '8128' if nothing else is found.
		const rawPort = myPortOpt || wsPortOpt || envPort || "8128";
		const port = parseInt(String(rawPort), 10);

		try {
			await webserver.listen("mcp", port);
			this.getWorld().eventLogger.info(
				`[MCP] WebServer started on port ${port}`,
			);
		} catch (e) {
			if ((e as { code?: string })?.code !== "EADDRINUSE") {
				const msg = `[MCP] WebServer listen failure: ${e}`;
				this.getWorld().eventLogger.error(msg);
				throw new Error(msg);
			} else {
				this.getWorld().eventLogger.info(
					`[MCP] WebServer already listening on port ${port} (shared)`,
				);
			}
		}
	}

	// --- Session ID Helper ---
	private getSessionId(
		connection: ConnectionId | undefined,
		extra: {
			requestInfo?: { headers?: Record<string, string | string[] | undefined> };
		},
	): string | ConnectionId {
		// Try to get X-Session-ID header from request info
		const headers = extra?.requestInfo?.headers;
		const sessionId = headers?.["x-session-id"];
		if (typeof sessionId === "string") {
			return sessionId;
		}
		// Fallback to connection object if available and stable (it isn't usually for HTTP)
		if (connection) return connection;
		return "default-session";
	}

	private async updateSessionFocus(
		sessionId: string | ConnectionId,
		stepperName: string | undefined,
	) {
		if (stepperName === undefined) {
			this.sessionScopes.delete(sessionId);
		} else {
			this.sessionScopes.set(sessionId, stepperName);
		}
		await this.notifyToolListChanged(sessionId);
	}

	private async notifyToolListChanged(sessionId: string | ConnectionId) {
		// Basic check if we can notify
		if (
			sessionId &&
			typeof sessionId !== "string" &&
			"send" in sessionId &&
			typeof (sessionId as { send?: unknown }).send === "function"
		) {
			if (this.mcpServer) {
				await this.mcpServer.server.notification({
					method: "notifications/tools/list_changed",
				});
			}
		}
	}

	private buildIndexTools(): Tool[] {
		const tools: Tool[] = this.steppers.map((stepper) => {
			const name = constructorName(stepper);
			const desc =
				stepper.description || `List available tools for stepper: ${name}.`;
			return {
				name: `access_stepper_${name}`,
				description: desc,
				inputSchema: { type: "object", properties: {} },
			};
		});
		tools.push({
			name: "call_step",
			description:
				"Call a Haibun step tool by name. Use access_stepper_* first to discover available tool names and their schemas. Protected tools are authorized from the MCP bearer token, not from tool arguments.",
			inputSchema: {
				type: "object",
				properties: {
					tool: {
						type: "string",
						description: 'The tool name (e.g. "WebPlaywright-goToPage")',
					},
					arguments: {
						type: "object",
						description: "Arguments for the tool, matching its input schema",
					},
				},
				required: ["tool"],
			},
		});
		return tools;
	}

	private populateToolRegistries(registry?: StepRegistry) {
		// Build schema map — use provided registry if available (live refresh), otherwise build fresh
		const schemaMap = registry
			? new Map(registry.list().map((t) => [t.name, t]))
			: buildStepRegistry(this.steppers, this.world);

		this.globalToolRegistry.clear();
		this.stepperToolRegistry.clear();

		for (const stepper of this.steppers) {
			const stepperName = constructorName(stepper);
			const tools: StoredTool[] = [];

			for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
				if (stepDef.exposeMCP === false) continue;

				const fullToolName = `${stepperName}-${stepName}`;
				const stepTool = schemaMap.get(fullToolName);
				if (!stepTool) continue;

				// Strip metadata that can confuse some MCP clients
				const inputSchema = { ...stepTool.inputSchema };
				delete inputSchema["$schema"];
				delete inputSchema["additionalProperties"];
				const toolDescription = stepTool.description;
				const tool: StoredTool = {
					name: fullToolName,
					description: stepTool.capability
						? `${toolDescription} Requires capability: ${stepTool.capability}.`
						: toolDescription,
					inputSchema,
					stepperName,
					capability: stepTool.capability,
					stepTool,
					handler: async (input: Record<string, unknown>, grantedCapability?: string | string[]): Promise<CallToolResult> => {
						this.getWorld().eventLogger.info(`[MCP] Tool Execution: ${fullToolName}`);
						const world = this.getWorld();
						const seqPath: number[] = [0, (world.runtime.adHocSeq = (world.runtime.adHocSeq ?? 0) + 1)];
						const hr = await dispatchRemoteToolCall({
							tool: stepTool,
							input,
							world,
							seqPath,
							grantedCapability,
						});
						if (!hr.ok) {
							return {
								isError: true,
								content: [{ type: "text", text: hr.errorMessage ?? "Step failed" }],
							};
						}
						return {
							content: [
								{ type: "text", text: JSON.stringify(hr.products ?? {}, null, 2) },
							],
						};
					},
				};
				tools.push(tool);
				this.globalToolRegistry.set(fullToolName, tool);
			}
			this.stepperToolRegistry.set(stepperName, tools);
		}
	}

	private getGrantedCapability(extra: {
		requestInfo?: { headers?: Record<string, string | string[] | undefined> };
	}): string[] | undefined {
		const headers = extra.requestInfo?.headers;
		if (!headers) return undefined;
		const normalizedHeaders = Object.fromEntries(
			Object.entries(headers).map(([key, value]) => [
				key,
				Array.isArray(value) ? value[0] : value,
			]),
		);
		return getGrantedCapabilityFromHeaders(normalizedHeaders, this.getWorld().runtime, {
			accessToken: this.accessToken || undefined,
			accessCapability: this.accessCapability || undefined,
		});
	}

	private setupMiddleware(webserver: IWebServer) {
		const applyMcpMiddleware = async (
			c: Context,
			next: () => Promise<void>,
		) => {
			// 1. CORS
			c.header("Access-Control-Allow-Origin", "*");
			c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			c.header(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization, Accept, X-Custom-Header, X-Session-ID",
			);

			if (c.req.method === "OPTIONS") return c.body(null, 204);

			// 2. Auth
			if (this.accessToken) {
				const auth = c.req.header("authorization");
				if (
					!auth?.startsWith("Bearer ") ||
					auth.slice(7) !== this.accessToken
				) {
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
			// For GET requests, we manually construct a new Request object.
			// For non-GET (POST), we MUST avoid the Request constructor as it doesn't reuse the body.
			// Instead, we proxy the raw request to intercept header access.
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

			// 2. CREATE A ROBUST PROXY FOR THE CONTEXT
			// We must bind all functions to the original target to avoid
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
								return typeof val === "function"
									? (val as (...args: unknown[]) => unknown).bind(reqTarget)
									: val;
							},
						});
					}
					const val = Reflect.get(target, prop);
					return typeof val === "function"
						? (val as (...args: unknown[]) => unknown).bind(target)
						: val;
				},
			});

			const transport = this.transport;
			if (!transport) throw new Error("Transport not initialized");
			const response = await transport.handleRequest(proxyContext);

			if (!response) {
				this.getWorld().eventLogger.warn(
					"[MCP] No response generated by transport",
				);
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
