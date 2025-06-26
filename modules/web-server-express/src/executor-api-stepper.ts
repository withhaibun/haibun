import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TNamed } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, actionOK, getFromRuntime, getStepperOption } from '@haibun/core/build/lib/util/index.js';
import { IWebServer, WEBSERVER } from './defs.js';
import { Executor } from '@haibun/core/build/phases/Executor.js';
import { asFeatures } from '@haibun/core/build/lib/resolver-features.js';
import { createSteppers, setStepperWorlds } from '@haibun/core/build/lib/util/index.js';
import { Resolver } from '@haibun/core/build/phases/Resolver.js';
import { expand } from '@haibun/core/build/lib/features.js';
import { applyEffectFeatures } from '@haibun/core/build/applyEffectFeatures.js';

export class ExecutorApiStepper extends AStepper implements IHasOptions {
	options = {
		EXECUTOR_API_PATH: {
			desc: 'API path for executor endpoints (default: /api/executor)',
			parse: (path: string) => ({ result: path }),
		},
	};

	steps = {
		setupExecutorApi: {
			gwta: 'setup executor API at {path}',
			action: ({ path }: TNamed) => {
				const apiPath = path || getStepperOption(this, 'EXECUTOR_API_PATH', this.getWorld().moduleOptions) || '/api/executor';
				const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);

				if (!webserver) {
					return Promise.resolve(actionNotOK('Web server not available. Ensure web-server-stepper is configured.'));
				}

				this.setupExecutorRoutes(webserver, apiPath);
				return Promise.resolve(actionOK());
			},
		},
	};

	private setupExecutorRoutes(webserver: IWebServer, basePath: string) {
		const world = this.getWorld();

		// POST /api/executor/features - Execute features
		webserver.addRoute('post', `${basePath}/features`, (req, res) => {
			void (async () => {
				try {
					const { features, steppers, options } = req.body;

					if (!features || !Array.isArray(features)) {
						res.status(400).json({
							error: 'Invalid request: features array is required'
						});
						return;
					}

					// Convert feature content to resolved features
					const featureObjects = asFeatures(features.map(f => ({
						path: f.path || '/api/feature',
						content: f.content
					})));

					// Create steppers
					const stepperClasses = steppers || [];
					const createdSteppers = await createSteppers(stepperClasses);

					// Create execution world
					const executionWorld = {
						...world,
						...(options || {}),
						tag: { ...world.tag, source: 'api' }
					};

					await setStepperWorlds(createdSteppers, executionWorld);

					// Resolve and execute features
					const expandedFeatures = await expand({ features: featureObjects, backgrounds: [] });
					const resolver = new Resolver(createdSteppers);
					const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);
					const appliedFeatures = await applyEffectFeatures(executionWorld, resolvedFeatures, createdSteppers);

					const result = await Executor.executeFeatures(createdSteppers, executionWorld, appliedFeatures);

					res.json({
						success: true,
						result: {
							ok: result.ok,
							featureResults: result.featureResults?.map(fr => ({
								path: fr.path,
								ok: fr.ok,
								stepCount: fr.stepResults.length,
								failedSteps: fr.stepResults.filter(sr => !sr.ok).length
							})),
							summary: {
								totalFeatures: result.featureResults?.length || 0,
								passedFeatures: result.featureResults?.filter(fr => fr.ok).length || 0,
								failedFeatures: result.featureResults?.filter(fr => !fr.ok).length || 0
							}
						}
					});
				} catch (error) {
					world.logger.error('API execution error:', error);
					res.status(500).json({
						error: 'Execution failed',
						message: error.message
					});
				}
			})();
		});

		// GET /api/executor/status - Get executor status
		webserver.addRoute('get', `${basePath}/status`, async (req, res) => {
			res.json({
				status: 'ready',
				timestamp: new Date().toISOString(),
				version: '1.0.0'
			});
		});

		// POST /api/executor/validate - Validate features without execution
		webserver.addRoute('post', `${basePath}/validate`, async (req, res) => {
			try {
				const { features, steppers } = req.body;

				if (!features || !Array.isArray(features)) {
					return res.status(400).json({
						error: 'Invalid request: features array is required'
					});
				}

				const featureObjects = asFeatures(features.map(f => ({
					path: f.path || '/api/feature',
					content: f.content
				})));

				const stepperClasses = steppers || [];
				const createdSteppers = await createSteppers(stepperClasses);
				await setStepperWorlds(createdSteppers, world);

				const expandedFeatures = await expand({ features: featureObjects, backgrounds: [] });
				const resolver = new Resolver(createdSteppers);
				const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);

				res.json({
					success: true,
					validation: {
						featuresCount: resolvedFeatures.length,
						totalSteps: resolvedFeatures.reduce((sum, f) => sum + f.featureSteps.length, 0),
						features: resolvedFeatures.map(f => ({
							path: f.path,
							stepCount: f.featureSteps.length,
							valid: true
						}))
					}
				});
			} catch (error) {
				world.logger.error('API validation error:', error);
				res.status(500).json({
					error: 'Validation failed',
					message: error.message
				});
			}
		});

		world.logger.log(`Executor API routes configured at ${basePath}`);
	}
}

export default ExecutorApiStepper;
