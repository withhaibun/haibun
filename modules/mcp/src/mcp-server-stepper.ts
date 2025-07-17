import { AStepper, IHasOptions } from '@haibun/core/lib/astepper.js';
import { OK, TWorld } from '@haibun/core/lib/defs.js';
import { actionNotOK, getStepperOption, intOrError } from '@haibun/core/lib/util/index.js';
import { MCPExecutorServer } from './lib/mcp-executor-server.js';

class MCPServerStepper extends AStepper implements IHasOptions {
	steppers: AStepper[];
	mcpServer: MCPExecutorServer;
	remotePort: number;
	accessToken: string;

	options = {
		REMOTE_PORT: {
			desc: 'Port for remote execution API',
			parse: (port: string) => ({ result: parseInt(port, 10) }),
		},
		ACCESS_TOKEN: {
			desc: 'Access token for remote execution API authentication',
			parse: (token: string) => ({ result: token }),
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;

		this.remotePort = intOrError(getStepperOption(this, 'REMOTE_PORT', world.moduleOptions) || '').result || NaN;
		this.accessToken = getStepperOption(this, 'ACCESS_TOKEN', world.moduleOptions);

		if (!isNaN(this.remotePort) && !this.accessToken) {
			throw new Error('ACCESS_TOKEN is required when REMOTE_PORT is configured for remote execution');
		}
	}

	private getRemoteConfig() {
		if (!isNaN(this.remotePort)) {
			return {
				url: `http://localhost:${this.remotePort}`,
				accessToken: this.accessToken
			};
		}

		return undefined;
	}

	steps = {
		startMcpTools: {
			gwta: `serve mcp tools from steppers`,
			action: async () => {
				const remoteConfig = this.getRemoteConfig();

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
