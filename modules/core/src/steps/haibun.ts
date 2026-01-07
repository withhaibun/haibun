import { TFeatureStep, TWorld, IStepperCycles, TFeatures, TResolvedFeature, TStartExecution, TStartFeature, CycleWhen } from '../lib/defs.js';
import { OK, STEP_DELAY } from '../schema/protocol.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK, formattedSteppers, sleep } from '../lib/util/index.js';
import { findFeatureStepsFromStatement } from '../phases/Resolver.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { findFeatures } from '../lib/features.js';
import { FlowRunner } from '../lib/core/flow-runner.js';

class Haibun extends AStepper implements IHasCycles {
	description = 'Core steps for features, scenarios, backgrounds, and prose';

	afterEverySteps: { [stepperName: string]: TFeatureStep[] } = {};
	steppers: AStepper[] = [];
	resolvedFeature: TResolvedFeature;
	private runner: FlowRunner;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.runner = new FlowRunner(world, steppers);
	}
	cycles: IStepperCycles = {
		startExecution(resolvedFeatures: TStartExecution) {
			// empty
		},
		startFeature({ resolvedFeature, index }: TStartFeature) {
			this.resolvedFeature = resolvedFeature;
		},
		afterStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
			if (featureStep.isSubStep) {
				return Promise.resolve({ failed: false });
			}
			const afterEvery = this.afterEverySteps[featureStep.action.stepperName];
			let failed = false;
			if (afterEvery) {
				const stepsToRun = afterEvery.filter(aeStep => aeStep.action.actionName !== featureStep.action.actionName);

				if (stepsToRun.length > 0) {
					const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
					const res = await this.runner.runSteps(stepsToRun, { intent: { mode }, parentStep: featureStep });
					if (res.kind !== 'ok') {
						failed = true;
					}
				}
			}
			return Promise.resolve({ failed });
		}
	};
	cyclesWhen = {
		startExecution: CycleWhen.LAST,
		startFeature: CycleWhen.LAST,
	}


	steps = {
		until: {
			gwta: `until {statements:${DOMAIN_STATEMENT}}`,
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				let signal;
				const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
				do {
					signal = await this.runner.runSteps(statements, { intent: { mode, usage: 'polling' }, parentStep: featureStep });
					if (signal.fatal) {
						return actionNotOK('until: aborted due to terminal error');
					}
					if (signal.kind !== 'ok') {
						await sleep(200);
					}
				} while (signal.kind !== 'ok');
				return OK;
			},
		},

		backgrounds: {
			gwta: 'Backgrounds: {names}',
			resolveFeatureLine: (line: string, _path: string, _stepper: AStepper, backgrounds: TFeatures) => {
				if (!line.match(/^Backgrounds:\s*/i)) {
					return false;
				}

				const names = line.replace(/^Backgrounds:\s*/i, '').trim();
				const bgNames = names.split(',').map((a) => a.trim());

				for (const bgName of bgNames) {
					const bg = findFeatures(bgName, backgrounds);
					if (bg.length !== 1) {
						throw new Error(`can't find single "${bgName}.feature" from ${backgrounds.map((b) => b.path).join(', ')}`);
					}
				}
				return false;
			},
			action: async ({ names }: { names: string }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				// Prepend 'Backgrounds: ' so expandLine correctly recognizes this as a background directive
				const expanded = findFeatureStepsFromStatement(`Backgrounds: ${names}`, this.steppers, world, featureStep.source.path, featureStep.seqPath, 1);
				const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
				const result = await this.runner.runSteps(expanded, { intent: { mode }, parentStep: featureStep });
				return result.kind === 'ok' ? OK : actionNotOK(`backgrounds failed: ${result.message}`);
			},
		},
		nothing: {
			exact: '',
			action: () => OK,
		},
		prose: {
			match: /^([A-Z].*[.!?:;]|[^a-zA-Z].*)$/,
			fallback: true,
			action: () => OK,
		},

		feature: {
			gwta: 'Feature: {feature}',
			handlesUndefined: ['feature'],
			action: ({ feature }: { feature: string }) => {
				this.getWorld().runtime.feature = feature;
				return OK;
			}
		},
		scenario: {
			gwta: 'Scenario: {scenario}',
			handlesUndefined: ['scenario'],
			action: ({ scenario }: { scenario: string }) => {
				this.getWorld().runtime.scenario = scenario;
				return OK;
			}

		},
		startStepDelay: {
			gwta: 'step delay of {ms:number}ms',
			action: (({ ms }: { ms: number }) => {
				this.getWorld().options[STEP_DELAY] = ms;
				return OK;
			}),
		},
		endsWith: {
			gwta: 'ends with {result}',
			action: (({ result }: { result: string }) => (result.toUpperCase() === 'OK' ? actionOK() : actionNotOK('ends with not ok'))),
		},
		showSteppers: {
			exact: 'show steppers',
			action: () => {
				const allSteppers = formattedSteppers(this.steppers);
				this.getWorld().eventLogger.info(JSON.stringify(allSteppers, null, 2));
				return actionOK();
			},
		},
		showSteps: {
			gwta: 'show step results',
			action: () => {
				const steps = this.getWorld().runtime.stepResults;
				this.getWorld().eventLogger.info(JSON.stringify(steps));
				return actionOK();
			}
		},
		showFeatures: {
			gwta: 'show features',
			action: () => {
				return actionOK();
			}
		},
		showBackgrounds: {
			gwta: 'show backgrounds',
			action: () => {
				return actionOK();
			}
		},
		showQuadStore: {
			exact: 'show quadstore',
			action: () => {
				const quads = this.getWorld().shared.allQuads();
				const output = quads.map(q =>
					`(${q.subject}, ${q.predicate}, ${JSON.stringify(q.object)}, ${q.namedGraph || 'default'})`
				).join('\n');
				this.getWorld().eventLogger.info(`\n=== QuadStore Dump (${quads.length} quads) ===\n${output}\n==========================\n`);
				return OK;
			},
		},
		showObservations: {
			gwta: 'show observations',
			action: () => {
				const observations = this.getWorld().runtime.observations;
				if (!observations) {
					this.getWorld().eventLogger.info(`observations: none`);
					return actionOK();
				}

				// Correlate observations with their providers
				const providers: Record<string, string> = {};
				for (const stepper of this.steppers) {
					if ('cycles' in stepper) {
						const concerns = (stepper as unknown as IHasCycles).cycles.getConcerns?.();
						if (concerns?.sources) {
							for (const source of concerns.sources) {
								providers[source.name] = stepper.constructor.name;
							}
						}
					}
				}

				const systemProviders: Record<string, string> = {
					stepUsage: 'Executor'
				};

				const summary: Record<string, { provider: string, items: unknown }> = {};
				for (const [name, items] of observations.entries()) {
					// Handle Maps (like httpRequests/httpHosts) by converting to object/array
					let displayItems = items;
					if (items instanceof Map) {
						displayItems = Object.fromEntries(items);
					}

					summary[name] = {
						provider: providers[name] || systemProviders[name] || 'unknown',
						items: displayItems
					};
				}

				this.getWorld().eventLogger.info(JSON.stringify(summary, null, 2));
				return actionOK();
			}
		},
		showShows: {
			gwta: 'show shows',
			action: () => {
				const shows: string[] = [];
				for (const stepper of this.steppers) {
					for (const step of Object.values(stepper.steps)) {
						if (step.gwta?.startsWith('show ') || step.exact?.startsWith('show ')) {
							shows.push(step.gwta || step.exact || '');
						}
					}
				}
				this.getWorld().eventLogger.info(JSON.stringify(shows.sort(), null, 2));
				return actionOK();
			}
		},
		pauseSeconds: {
			gwta: 'pause for {ms:number}s',
			action: (async ({ ms }: { ms: number }) => { await sleep(ms * 1000); return OK; }),
		},
		comment: {
			gwta: ';;{comment}',
			handlesUndefined: ['comment'],
			action: () => OK,
		},
		afterEveryStepper: {
			precludes: [`Haibun.prose`],
			gwta: `after every {stepperName: string}, {statement: ${DOMAIN_STATEMENT}}`,
			handlesUndefined: ['stepperName'],
			action: ({ stepperName, statement }: { stepperName: string; statement: TFeatureStep[] }) => {
				this.afterEverySteps[stepperName] = statement;
				return OK;
			},
		},
	} satisfies TStepperSteps;

}
export default Haibun;
