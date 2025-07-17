import { AStepper, IHasCycles, IHasOptions } from '@haibun/core/lib/astepper.js';
import { TStepResult, TWorld } from '@haibun/core/lib/defs.js';
import { resolveAndExecuteStatement } from "@haibun/core/lib/util/resolveAndExecuteStatement.js";
import { actionNotOK, actionOK, getFromRuntime, getStepperOption, intOrError } from '@haibun/core/lib/util/index.js';
import { IRequest, IResponse, IWebServer, WEBSERVER } from './defs.js';
import WebServerStepper from './web-server-stepper.js';
import { HttpPrompter } from './http-prompter.js';

export const HTTP_PROMPTER_ENDPOINTS = {
	PROMPTS: '/prompts', // GET: list all pending prompts
	PROMPT_RESPONSE: '/prompt', // POST: respond to a prompt { promptId, response }
};

export default class HttpExecutorStepper extends AStepper implements IHasOptions, IHasCycles {
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
	cycles = {
		async startFeature() {
			await this.addRemoteExecutorRoute();
		},
		async endFeature() {
			await this.close();
		}
	}

	private routeAdded = false;
	private steppers: AStepper[] = [];
	protected httpPrompter?: HttpPrompter;
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
			(async () => {
				try {
					console.log(`📥 HTTP Executor: Received request for statement: "${req.body?.statement}"`);
					
					if (!this.checkAuth(req, res)) {
						return;
					}

					if (!['statement', 'source'].every(key => typeof req.body[key] === 'string')) {
						this.getWorld().logger.warn(`missing or invalid body parameters: ${JSON.stringify(req.body)}`);
						res.status(400).json({ error: 'statement and source are required' });
						return;
					}
					const { statement, source } = req.body;

					console.log(`🔄 HTTP Executor: Starting execution of "${statement}" from ${source}`);
					const world = this.getWorld();
					const steppers = this.steppers;

					const result: TStepResult = await resolveAndExecuteStatement(statement, source, steppers, world);
					console.log(`✅ HTTP Executor: Execution completed`, result);

					res.json(result);

				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					const stack = error instanceof Error ? error.stack : 'No stack trace';
					console.error(`❌ HTTP Executor: Error during execution:`, {
						error: errorMessage,
						stack,
						statement: req.body?.statement,
						source: req.body?.source
					});
					res.status(500).json({
						error: errorMessage,
						success: false
					});
				}
			})().catch(error => {
				console.error(`❌ HTTP Executor: Unhandled async error:`, error);
				if (!res.headersSent) {
					res.status(500).json({
						error: 'Internal server error',
						success: false
					});
				}
			});
		});

		// Add prompt handling routes
		webserver.addRoute('get', '/prompts', (req: IRequest, res: IResponse) => {
			if (!this.checkAuth(req, res)) {
				return;
			}

			const prompts = this.httpPrompter.getPendingPrompts();
			res.json({ prompts });
		});

		webserver.addRoute('post', '/prompt', (req: IRequest, res: IResponse) => {
			try {
				if (!this.checkAuth(req, res)) {
					return;
				}

				if (!['promptId', 'response'].every(key => req.body[key] !== undefined)) {
					res.status(400).json({ error: 'promptId and response are required' });
					return;
				}

				const { promptId, response } = req.body;

				this.httpPrompter.resolve(promptId, response);
				res.json({ success: true, promptId, fixme: "This should actually test if it passed" });

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				res.status(500).json({ error: errorMessage });
			}
		});

		this.routeAdded = true;
		this.getWorld().logger.warn(`⚠️  Remote executor route added with ACCESS_TOKEN on port ${this.port}.`);
	}
	checkAuth(req: IRequest, res: IResponse): boolean {
		const authHeader = req.headers.authorization;
		const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

		if (!providedToken || providedToken !== this.configuredToken) {
			this.getWorld().logger.warn(`Unauthorized access attempt with token: "${providedToken}"`);
			res.status(401).json({ error: 'Invalid or missing access token' });
			return false;
		}
		
		return true;
	}

	steps = {
		enableRemoteExecutor: {
			gwta: 'enable remote executor',
			action: () => {
				if (isNaN(this.port)) {
					return Promise.resolve(actionNotOK('Remote executor is not configured - LISTEN_PORT is not set'));
				}
				this.addRemoteExecutorRoute();
				this.httpPrompter = new HttpPrompter(this.getWorld());
				return Promise.resolve(actionOK());
			},
		},
	}
	close() {
		if (this.httpPrompter) {
			this.world.prompter.unsubscribe(this.httpPrompter);
			this.httpPrompter = undefined;
		}
	}
}
