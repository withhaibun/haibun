import { AStepper } from '@haibun/core/build/lib/astepper.js';
import { OK, TWorld } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { MCPExecutorServer } from './lib/mcp-executor-server.js';

class MCPServerStepper extends AStepper {
	steppers: AStepper[];
	mcpServer: MCPExecutorServer;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	steps = {
		startMcpTools: {
			gwta: `serve mcp tools from steppers`,
			action: async () => {
				this.mcpServer = new MCPExecutorServer(this.steppers, this.world);
				void this.mcpServer.start();
				return Promise.resolve(OK);
			}
		},
		stopMcpTools: {
			gwta: `stop mcp tools`,
			action: async () => {
				if (this.mcpServer) {
					await this.mcpServer.server.close();
					this.mcpServer = undefined;
					return OK;
				} else {
					return actionNotOK('MCP server is not running');
				}
			}
		}
	}
}

export default MCPServerStepper;
