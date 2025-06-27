import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { OK, TWorld } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, getStepperOption } from '@haibun/core/build/lib/util/index.js';
import { MCPExecutorServer } from './lib/mcp-executor-server.js';

class MCPServerStepper extends AStepper implements IHasOptions {
	steppers: AStepper[];
	mcpServer: MCPExecutorServer;
	options = {
		REMOTE_PORT: {
			desc: 'Port for remote execution API',
			parse: (port: string) => ({ result: parseInt(port, 10) }),
		},
		ACCESS_TOKEN: {
			desc: 'Access token for remote execution API authentication',
			parse: (token: string) => ({ result: token }),
			required: true
		},
	};
	remotePort: any;
	accessToken: any;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.remotePort = getStepperOption(this, 'REMOTE_PORT', world.moduleOptions);
		this.accessToken = getStepperOption(this, 'ACCESS_TOKEN', world.moduleOptions);
	}

	steps = {
		startMcpTools: {
			gwta: `serve mcp tools from steppers`,
			action: async () => {
				// Create remote configuration if port and token are available
				const remoteConfig = this.remotePort && this.accessToken ? {
					url: `http://localhost:${this.remotePort}`,
					accessToken: this.accessToken
				} : undefined;

				this.mcpServer = new MCPExecutorServer(this.steppers, this.world, remoteConfig);
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
