import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TStepResult, TWorld } from '@haibun/core/build/lib/defs.js';
import { FeatureExecutor } from '@haibun/core/build/phases/Executor.js';
import { actionOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/build/lib/util/index.js';
import { IRequest, IResponse, IWebServer, WEBSERVER } from './defs.js';
import WebServerStepper from './web-server-stepper.js';
import { getActionableStatement } from '@haibun/core/build/phases/Resolver.js';

export default class HttpExecutorStepper extends AStepper implements IHasOptions {
	options = {
		LISTEN_PORT: {
			desc: 'Port for remote execution API',
			parse: (port: string) => ({ result: parseInt(port, 10) }),
		},
		ACCESS_TOKEN: {
			desc: 'Access token for remote execution API authentication',
			parse: (token: string) => ({ result: token }),
		},
	};

	private routeAdded = false;
	private steppers: AStepper[] = [];
	configuredToken: string;
	port: number;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);

		this.port = intOrError(getStepperOption(this, 'LISTEN_PORT', world.moduleOptions) || '').result || NaN;
		this.configuredToken = getStepperOption(this, 'ACCESS_TOKEN', this.getWorld().moduleOptions);
		this.steppers = steppers;
		if (!isNaN(this.port)) {
			if (!this.configuredToken) {
				throw new Error('ACCESS_TOKEN is required when enabling remote executor');
			}
			const webServerStepper = steppers.find(s => s instanceof WebServerStepper) as WebServerStepper;
			if (webServerStepper) {
				webServerStepper.port = this.port;
			}
		}
	}
	addRemoteExecutorRoute() {
		if (this.routeAdded) {
			return;
		}

		const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
		if (!webserver) {
			throw new Error('WebServer not available - ensure web-server-stepper is loaded');
		}

		webserver.addRoute('post', '/execute-step', (req: IRequest, res: IResponse) => {
			void (async () => {
				try {
					const authHeader = req.headers.authorization;
					const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

					if (!providedToken || providedToken !== this.configuredToken) {
						res.status(401).json({ error: 'Invalid or missing access token' });
						return;
					}

					if (!['statement', 'source'].every(key => typeof req.body[key] === 'string')) {
						res.status(400).json({ error: 'statement and source are required' });
						return;
					}
					const { statement, source } = req.body;

					const world = this.getWorld();
					const steppers = this.steppers;

					const { featureStep } = await getActionableStatement(steppers, statement, source);

					const result: TStepResult = await FeatureExecutor.doFeatureStep(
						steppers,
						featureStep,
						world
					);

					res.json(result);

				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					res.status(500).json({
						error: errorMessage,
						success: false
					});
				}
			})();
		});

		this.routeAdded = true;
		this.getWorld().logger.warn('⚠️  DANGEROUS: Remote executor route added at /execute-step');
	}

	steps = {
		enableRemoteExecutor: {
			gwta: 'enable remote executor',
			action: () => {
				this.addRemoteExecutorRoute();
				return Promise.resolve(actionOK());
			},
		},
	};
}
