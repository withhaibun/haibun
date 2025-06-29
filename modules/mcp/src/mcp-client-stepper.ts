import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { BasePromptManager } from '@haibun/core/build/lib/base-prompt-manager.js';
import { AStepper, IHasCycles, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TWorld, TNamed, TFeatureStep, IStepperCycles } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, actionOK, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { currentVersion as version } from '@haibun/core/build/currentVersion.js';
import { EExecutionMessageType, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { TPrompt, TPromptResponse } from '@haibun/core/build/lib/prompter.js';

class MCPClientPrompter extends BasePromptManager {
	private client?: Client<any, any, any>;
	private isConnected = false;

	constructor(private serverParameters: StdioServerParameters) {
		super();
	}

	protected showPrompt(prompt: TPrompt): void {}
	protected hidePrompt(id: string): void {}

	private async ensureConnection(): Promise<void> {
		if (this.isConnected && this.client) {
			return;
		}

		this.client = new Client({ name: "haibun-mcp-prompter", version });
		const transport = new StdioClientTransport(this.serverParameters);
		await this.client.connect(transport);
		this.isConnected = true;
	}

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		try {
			await this.ensureConnection();

			if (!this.client) {
				return undefined;
			}

			const result = await this.client.callTool({
				name: 'handlePrompt',
				arguments: {
					message: prompt.message,
					context: prompt.context ? JSON.stringify(prompt.context) : undefined,
					options: prompt.options || []
				}
			});

			if (result.content && Array.isArray(result.content) && result.content.length > 0) {
				const content = result.content[0];
				if (content.type === 'text') {
					try {
						const responseData = JSON.parse(content.text);
						return responseData.response;
					} catch {
						return content.text;
					}
				}
			}

			return undefined;

		} catch (error) {
			console.debug(`MCP prompter failed: ${error}`);
			return undefined;
		}
	}

	async close(): Promise<void> {
		if (this.client && this.isConnected) {
			await this.client.close();
			this.isConnected = false;
			this.client = undefined;
		}
	}
}

const cycles = (mcs: MCPClientStepper): IStepperCycles => ({
	async endFeature() {
		if (mcs.client && mcs.isConnected) {
			await this.client.close();
			mcs.isConnected = false;
			mcs.client = undefined;
		}

		if (mcs.mcpPrompter) {
			await mcs.mcpPrompter.close();
			mcs.mcpPrompter = undefined;
		}
	}
});

class MCPClientStepper extends AStepper implements IHasOptions, IHasCycles {
	static SERVER = 'SERVER';
	cycles = cycles(this);
	options = {
		[MCPClientStepper.SERVER]: {
			desc: `MCP server to start (stdio)`,
			parse: (input: string) => stringOrError(input)
		},
	}
	serverParameters: StdioServerParameters;
	client?: Client<{ method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; progressToken?: string | number; }; }; }, { method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }; }, { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }>;
	isConnected = false;
	mcpPrompter?: MCPClientPrompter;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const serverJson = getStepperOption(this, MCPClientStepper.SERVER, this.world.moduleOptions);
		try {
			this.serverParameters = JSON.parse(serverJson);
		} catch (e) {
			throw new Error(`Failed to parse ${MCPClientStepper.SERVER} option: ${e}`);
		}
	}

	private async ensureConnection(): Promise<void> {
		if (this.isConnected && this.client) {
			return;
		}

		this.client = new Client({ name: "haibun-mcp-client", version });
		const transport = new StdioClientTransport(this.serverParameters);
		await this.client.connect(transport);
		this.isConnected = true;
	}

	steps = {
		registerMcpPrompter: {
			gwta: `register mcp prompter`,
			action: async (named: TNamed, featureStep: TFeatureStep) => {
				try {
					if (!this.mcpPrompter) {
						this.mcpPrompter = new MCPClientPrompter(this.serverParameters);
						this.world.prompter.subscribe(this.mcpPrompter);
					}
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { registered: true }
					}
					return actionOK({ messageContext });
				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to register MCP prompter: ${e}`);
				}
			}
		},
		unregisterMcpPrompter: {
			gwta: `unregister mcp prompter`,
			action: async (named: TNamed, featureStep: TFeatureStep) => {
				try {
					if (this.mcpPrompter) {
						this.world.prompter.unsubscribe(this.mcpPrompter);
						await this.mcpPrompter.close();
						this.mcpPrompter = undefined;
					}
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { unregistered: true }
					}
					return actionOK({ messageContext });
				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to unregister MCP prompter: ${e}`);
				}
			}
		},
		listMcpTools: {
			gwta: `list mcp tools`,
			action: async (named: TNamed, featureStep: TFeatureStep) => {
				try {
					await this.ensureConnection();
					const toolsResult = await this.client!.listTools();
					const tools = Array.isArray(toolsResult) ? toolsResult : (toolsResult.tools || []);
					const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { tools } }
					return actionOK({ messageContext });
				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to list MCP tools: ${e}`);
				}
			}
		},
		promptViaMcp: {
			gwta: `prompt via mcp {message} with options {options}`,
			action: async ({ message, options }: TNamed, featureStep: TFeatureStep) => {
				try {
					await this.ensureConnection();

					const prompt: TPrompt = {
						id: 'test-' + Math.random().toString(36).slice(2),
						message,
						options: options ? options.split(',').map(o => o.trim()) : undefined
					};

					// Try to call a prompt handling tool on the MCP server
					const result = await this.client!.callTool({
						name: 'handlePrompt',
						arguments: {
							message: prompt.message,
							context: prompt.context ? JSON.stringify(prompt.context) : undefined,
							options: prompt.options || []
						}
					});

					// Parse the response from the MCP tool
					if (result.content && Array.isArray(result.content) && result.content.length > 0) {
						const content = result.content[0];
						if (content.type === 'text') {
							try {
								const responseData = JSON.parse(content.text);
								const messageContext: TMessageContext = {
									incident: EExecutionMessageType.ACTION,
									incidentDetails: { response: responseData.response }
								}
								return actionOK({ messageContext });
							} catch {
								// If parsing fails, return the text directly
								const messageContext: TMessageContext = {
									incident: EExecutionMessageType.ACTION,
									incidentDetails: { response: content.text }
								}
								return actionOK({ messageContext });
							}
						}
					}

					return actionNotOK('No response received from MCP server');

				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to prompt via MCP: ${e}`);
				}
			}
		},
		promptViaMcpWithContext: {
			gwta: `prompt via mcp {message} with context {context} and options {options}`,
			action: async ({ message, context, options }: TNamed, featureStep: TFeatureStep) => {
				try {
					await this.ensureConnection();

					let parsedContext;
					try {
						parsedContext = JSON.parse(context);
					} catch {
						parsedContext = context;
					}

					const prompt: TPrompt = {
						id: 'test-' + Math.random().toString(36).slice(2),
						message,
						context: parsedContext,
						options: options ? options.split(',').map(o => o.trim()) : undefined
					};

					// Try to call a prompt handling tool on the MCP server
					const result = await this.client!.callTool({
						name: 'handlePrompt',
						arguments: {
							message: prompt.message,
							context: JSON.stringify(prompt.context),
							options: prompt.options || []
						}
					});

					// Parse the response from the MCP tool
					if (result.content && Array.isArray(result.content) && result.content.length > 0) {
						const content = result.content[0];
						if (content.type === 'text') {
							try {
								const responseData = JSON.parse(content.text);
								const messageContext: TMessageContext = {
									incident: EExecutionMessageType.ACTION,
									incidentDetails: { response: responseData.response }
								}
								return actionOK({ messageContext });
							} catch {
								// If parsing fails, return the text directly
								const messageContext: TMessageContext = {
									incident: EExecutionMessageType.ACTION,
									incidentDetails: { response: content.text }
								}
								return actionOK({ messageContext });
							}
						}
					}

					return actionNotOK('No response received from MCP server');

				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to prompt via MCP: ${e}`);
				}
			}
		}
	}
}

export default MCPClientStepper;
