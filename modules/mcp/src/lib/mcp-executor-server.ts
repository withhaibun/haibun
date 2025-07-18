import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';

import { AStepper } from "@haibun/core/lib/astepper.js";
import { namedInterpolation } from "@haibun/core/lib/namedVars.js";
import { currentVersion as version } from '@haibun/core/currentVersion.js';
import { TWorld, TStepperStep, TStepResult } from "@haibun/core/lib/defs.js";
import { constructorName } from "@haibun/core/lib/util/index.js";
import { resolveAndExecuteStatement } from "@haibun/core/lib/util/resolveAndExecuteStatement.js";
import { HttpPrompterClient } from './http-prompter-client.js';

type ToolHandlerResponse = { content?: TextContent[] };

type IRemoteExecutorConfig = {
	url: string;
	accessToken?: string;
};

export class MCPExecutorServer {
	server: McpServer;
	httpPrompterClient?: HttpPrompterClient;
	private samplingInterval?: NodeJS.Timeout;
	private _isRunning: boolean = false;
	
	get isRunning(): boolean {
		return this._isRunning;
	}
	
	constructor(private steppers: AStepper[], private world: TWorld, private remoteConfig?: IRemoteExecutorConfig) {
		// Log the execution mode
		if (remoteConfig) {
			this.world.logger.log(`🔗 MCPExecutorServer: Remote execution mode - connecting to ${remoteConfig.url}`);
		} else {
			this.world.logger.log(`🏠 MCPExecutorServer: Local execution mode`);
		}
	}

	async start() {
		this._isRunning = true;
		this.server = new McpServer({
			name: "haibun-mcp",
			version,
			capabilities: {
				resources: {},
				tools: {},
				sampling: {
					enabled: true
				}
			},
		});

		// Initialize HTTP prompter client for debug prompt access
		if (!this.remoteConfig?.url) {
			this.world.logger.warn(`⚠️  MCPExecutorServer: No remote config URL provided - debug prompt tools will not be available`);
			this.httpPrompterClient = undefined;
		} else {
			this.httpPrompterClient = new HttpPrompterClient(this.remoteConfig.url, this.remoteConfig.accessToken);
			this.world.logger.log(`🤖 MCPExecutorServer: HTTP prompter client initialized for debugging with URL ${this.remoteConfig.url}`);
			
			// Prompt notifications now handled by MCPClientPrompter - no sampling needed
			this.startPromptSampling();
		}

		this.registerSteppers();
		this.registerPromptTools();
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
	}

	registerSteppers() {
		for (const stepper of this.steppers) {
			const stepperName = constructorName(stepper);
			for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
				const variables: ZodRawShape = {};
				if (stepDef.gwta) {
					const { stepVariables } = namedInterpolation(stepDef.gwta);
					if (Array.isArray(stepVariables)) {
						for (const v of stepVariables) {
							variables[v.name] = v.type === 'number' ? z.number() : z.string();
						}
					}
				}
				const toolDescription: {
					description: string;
					title: string;
					inputSchema?: ZodRawShape;
				} = {
					description: stepName,
					title: (stepDef.gwta || stepDef.match?.toString() || stepDef.exact || stepName),
				}
				if (Object.keys(variables).length > 0) {
					toolDescription.inputSchema = variables;
				}

				const toolName = `${stepperName}-${stepName}`;
				this.server.registerTool(toolName, toolDescription, this.createToolHandler(stepperName, stepName, stepDef));
			}
		}
	}

	registerPromptTools() {
		// Tool to list pending debug prompts
		this.server.registerTool('listDebugPrompts', {
			description: 'List all pending debug prompts',
			title: 'List Debug Prompts'
		}, async (): Promise<ToolHandlerResponse> => {
			if (!this.httpPrompterClient) {
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: 'HttpPrompterClient not initialized - no remote config URL provided',
							prompts: [],
							count: 0
						}, null, 2)
					}]
				};
			}

			const prompts = await this.httpPrompterClient.getPrompts();
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						prompts,
						count: prompts.length,
						message: prompts.length > 0 ? 
							`Found ${prompts.length} pending debug prompt(s)` : 
							'No pending debug prompts'
					}, null, 2)
				}]
			};
		});

		// Tool to respond to debug prompts
		this.server.registerTool('respondToDebugPrompt', {
			description: 'Respond to a debug prompt to continue execution',
			title: 'Respond to Debug Prompt',
			inputSchema: {
				promptId: z.string(),
				response: z.string()
			}
		}, async (input: { promptId: string, response: string }): Promise<ToolHandlerResponse> => {
			if (!this.httpPrompterClient) {
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: 'HttpPrompterClient not initialized - no remote config URL provided',
							promptId: input.promptId
						}, null, 2)
					}]
				};
			}

			try {
				const result = await this.httpPrompterClient.respondToPrompt(input.promptId, input.response);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							promptId: input.promptId,
							response: input.response,
							result,
							message: `Debug prompt ${input.promptId} resolved with: "${input.response}"`
						}, null, 2)
					}]
				};
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: errorMessage,
							promptId: input.promptId
						}, null, 2)
					}]
				};
			}
		});
	}
	private createToolHandler(stepperName: string, stepName: string, stepDef: TStepperStep) {
		return async (input: Record<string, string | number | boolean | string[]>): Promise<ToolHandlerResponse> => {
			try {
				let statement = stepDef.gwta || stepDef.exact || stepDef.match?.toString();

				if (stepDef.gwta && Object.keys(input).length > 0) {
					// First, handle optional parts like ( empty)?
					// Remove optional parts that are not used (for now, just remove all optional parts)
					statement = statement.replace(/\([^)]*\)\?/g, '');
					
					// Then replace the named variables
					for (const [key, value] of Object.entries(input)) {
						const pattern = new RegExp(`\\{${key}(:[^}]*)?\\}`, 'g');
						statement = statement.replace(pattern, String(value));
					}
				}

				const stepResult: TStepResult = this.remoteConfig
					? await this.executeViaRemoteApi(statement, `/mcp/${stepperName}-${stepName}`)
					: await resolveAndExecuteStatement(statement, `/mcp/${stepperName}-${stepName}`, this.steppers, this.world);

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							stepName,
							stepperName,
							input,
							result: stepResult,
							success: stepResult.ok !== false
						}, null, 2)
					}]
				};

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							stepName,
							stepperName,
							input,
							error: errorMessage,
							success: false
						}, null, 2)
					}]
				};
			}
		}
	}

	private async executeViaRemoteApi(statement: string, source: string) {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.remoteConfig!.accessToken) {
			headers.Authorization = `Bearer ${this.remoteConfig!.accessToken}`;
			this.world.logger.log(`🔐 MCPExecutorServer: Using access token for authentication`);
		} else {
			this.world.logger.warn(`⚠️  MCPExecutorServer: No access token available for remote API call`);
		}

		const maxRetries = 3;
		const retryDelay = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const response = await fetch(`${this.remoteConfig!.url}/execute-step`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ statement, source })
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Remote execution failed: ${response.status} ${errorText}`);
				}

				const responseData = await response.json();
				return responseData;

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				if (attempt === maxRetries) {
					throw new Error(`Remote execution failed after ${maxRetries} attempts: ${errorMessage}`);
				}

				// Log retry attempt and wait before retrying
				this.world.logger.warn(`Remote execution attempt ${attempt} failed: ${errorMessage}. Retrying in ${retryDelay}ms...`);
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}
	}

	// REMOVED: Redundant prompt sampling system
	// Prompt notifications are now handled by MCPClientPrompter's showPrompt/hidePrompt methods
	// This provides real-time notifications without polling overhead
	startPromptSampling() {
		this.world.logger.log('📡 MCP: Prompt notifications handled by MCPClientPrompter - no polling needed');
	}

	stopPromptSampling() {
		this.world.logger.log('📡 MCP: No prompt sampling to stop - using real-time notifications');
	}
}
