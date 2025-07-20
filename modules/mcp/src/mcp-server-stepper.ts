import { AStepper, IHasOptions, IHasCycles } from '@haibun/core/lib/astepper.js';
import { OK, TWorld, IStepperCycles, TStartFeature } from '@haibun/core/lib/defs.js';
import { actionNotOK, getStepperOption, getStepperOptionName, intOrError } from '@haibun/core/lib/util/index.js';
import { MCPExecutorServer } from './lib/mcp-executor-server.js';

const cycles = (mcpStepper: MCPServerStepper): IStepperCycles => ({
	async startFeature({ resolvedFeature, index }: TStartFeature): Promise<void> {
		if (mcpStepper.mcpServer && mcpStepper.mcpServer.isRunning) {
			mcpStepper.getWorld().logger.debug(`🔗 Starting MCP sampling for feature ${index}: ${resolvedFeature.path}`);
			await mcpStepper.mcpServer.startPromptSampling();
		}
	},
	endFeature(): Promise<void> {
		if (mcpStepper.mcpServer && mcpStepper.mcpServer.isRunning) {
			mcpStepper.getWorld().logger.debug(`🔗 Stopping MCP sampling for feature`);
			mcpStepper.mcpServer.stopPromptSampling();
		}
		return Promise.resolve();
	}
});

class MCPServerStepper extends AStepper implements IHasOptions, IHasCycles {
	steppers: AStepper[];
	mcpServer: MCPExecutorServer;
	remotePort: number;
	accessToken: string;
	cycles: IStepperCycles = cycles(this);

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
			throw new Error(`${getStepperOptionName(this, 'ACCESS_TOKEN')} is required when REMOTE_PORT is configured for remote execution`);
		}

		// Log the remote configuration
		if (!isNaN(this.remotePort)) {
			this.getWorld().logger.warn(`🔗 MCP Server configured for remote execution on http://localhost:${this.remotePort}`);
		} else {
			this.getWorld().logger.info(`🏠 MCP Server configured for local execution`);
		}
	}

	private getRemoteConfig() {
		if (!isNaN(this.remotePort)) {
			const config = {
				url: `http://localhost:${this.remotePort}`,
				accessToken: this.accessToken
			};
			this.world.logger.log(`🔗 MCP Server configured for remote execution on ${config.url} with token: ${config.accessToken ? '[PRESENT]' : '[MISSING]'}`);
			return config;
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
