import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TWorld } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, actionOK, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { currentVersion as version } from '@haibun/core/build/currentVersion.js';
import { EExecutionMessageType, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';

class MCPClientStepper extends AStepper implements IHasOptions {
	static SERVER = 'SERVER';
	options = {
		[MCPClientStepper.SERVER]: {
			desc: `MCP server to start (stdio)`,
			parse: (input: string) => stringOrError(input)
		},
	}
	serverParameters: StdioServerParameters;
	client: Client<{ method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; progressToken?: string | number; }; }; }, { method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }; }, { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }>;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const serverJson = getStepperOption(this, MCPClientStepper.SERVER, this.world.moduleOptions);
		try {
			this.serverParameters = JSON.parse(serverJson);
		} catch (e) {
			throw new Error(`Failed to parse ${MCPClientStepper.SERVER} option: ${e}`);
		}
	}

	steps = {
		listMcpTools: {
			gwta: `list mcp tools`,
			action: async () => {
				try {
					this.client = new Client({ name: "haibun-mcp-client", version });
					const transport = new StdioClientTransport(this.serverParameters);
					await this.client.connect(transport);
					const toolsResult = await this.client.listTools();
					const tools = Array.isArray(toolsResult) ? toolsResult : (toolsResult.tools || []);
					await this.client.close();
					const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { tools } }
					return actionOK({ messageContext });
				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to list MCP tools: ${e}`);
				}
			}
		},
		shutdownMcpClient: {
			gwta: `shutdown mcp client`,
			action: async () => {
				try {
					const client = new Client({ name: "haibun-mcp-client", version });
					const transport = new StdioClientTransport(this.serverParameters);
					await client.connect(transport);
					await client.close();
					return actionOK();
				} catch (e) {
					console.error(e);
					return actionNotOK(`Failed to shutdown MCP client: ${e}`);
				}
			}
		}
	}
}

export default MCPClientStepper;
