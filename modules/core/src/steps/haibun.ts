import { OK, TFeatureStep, STEP_DELAY, TWorld, ExecMode, TStepResult, IStepperCycles, TFeatures, TResolvedFeature } from '../lib/defs.js';
import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK, formattedSteppers, sleep } from '../lib/util/index.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';
import { endExecutonContext } from '../phases/Executor.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { findFeatures } from '../lib/features.js';

class Haibun extends AStepper {
	afterEverySteps: { [stepperName: string]: TFeatureStep[] } = {};
	steppers: AStepper[] = [];
	resolvedFeature: TResolvedFeature;

	// eslint-disable-next-line @typescript-eslint/require-await
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
	}
	cycles: IStepperCycles = {
		// processes any afterEvery effects after each step
		startFeature: ({ resolvedFeature }: { resolvedFeature: TResolvedFeature }) => {
			this.resolvedFeature = resolvedFeature;
		},
		afterStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
			const afterEvery = this.afterEverySteps[featureStep.action.stepperName];
			let failed = false;
			if (afterEvery) {
				for (const aeStep of afterEvery) {
					// Skip if the afterEvery step is the same as the current step (prevent infinite recursion)
					if (aeStep.action.actionName === featureStep.action.actionName) {
						continue;
					}

					// Map the seqPath to extend from the current featureStep
					const mappedStep: TFeatureStep = {
						...aeStep,
						seqPath: [...featureStep.seqPath, ...(aeStep.seqPath.slice(1))],
					};
					// After every steps are substeps (triggered by parent step)
					const res = await executeSubFeatureSteps(featureStep, [mappedStep], this.steppers, this.getWorld(), ExecMode.NO_CYCLES, 1, true);
					if (!res.ok) {
						failed = true;
						break;
					}
				}
			}
			return Promise.resolve({ failed });
		}
	};

	steps = {
		// --- LOGIC OPERATORS ---		// Represents Logical Negation (~P).
		not: {
			gwta: `not {statements:${DOMAIN_STATEMENT}}`,
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const lastResult = await executeSubFeatureSteps(featureStep, statements, this.steppers, this.getWorld(), ExecMode.NO_CYCLES, -1);

				// Negation: action is OK if the inner statement failed (was NOT true)
				return lastResult.ok ? actionNotOK('not statement was true (failed negation)') : OK;
			},
		},

	// Represents Logical Implication (P => Q).
	if: {
		gwta: `if {ifStatements:${DOMAIN_STATEMENT}}, {thenStatements:${DOMAIN_STATEMENT}}`,
		action: async ({ ifStatements, thenStatements }: { ifStatements: TFeatureStep[], thenStatements: TFeatureStep[] }, featureStep: TFeatureStep) => {				// 1. Evaluate Antecedent (WHEN) - use dir=-1 for condition evaluation
				const ifResult = await executeSubFeatureSteps(featureStep, ifStatements, this.steppers, this.getWorld(), ExecMode.NO_CYCLES, -1);

				// If antecedent fails, the implication is true (vacuously true: F => T/F), so we return OK.
				if (!ifResult.ok) {
					return OK;
				}

				// 2. Evaluate Consequent (THEN) - use dir=1 for body execution
				const ifThenResult = await executeSubFeatureSteps(featureStep, thenStatements, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES, 1);

				// Consequent must succeed to prove the implication is true (T => T)
				return ifThenResult.ok ? OK : actionNotOK('if antecedent was TRUE, but consequent failed');
			},
		},

		// --- META & UTILITIES ---
		until: {
			gwta: 'until {statements:DOMAIN_STATEMENT}',
			action: (async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				let result: TStepResult;
				do {
					result = await executeSubFeatureSteps(featureStep, statements, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES);
					await sleep(500);
				} while (!result.ok);
				return OK;
			}),
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
				return false; // Don't skip - still needs to execute normally
			},
			action: async ({ names }: { names: string }, featureStep: TFeatureStep) => {
				// Expand backgrounds at runtime using world.runtime.backgrounds
				const world = this.getWorld();
				const expanded = findFeatureStepsFromStatement(names, this.steppers, world, featureStep.path, featureStep.seqPath, 1);
				const result = await executeSubFeatureSteps(featureStep, expanded, this.steppers, world, ExecMode.WITH_CYCLES);
				return result.ok ? OK : actionNotOK('backgrounds failed');
			},
		},

		prose: {
			match: /.+[.!?]$/,
			fallback: true,
			action: () => OK,
		},

		feature: {
			gwta: 'Feature: {feature}',
			action: ({ feature }: { feature: string }) => {
				this.getWorld().runtime.feature = feature;
				return OK;
			}
		},
		scenario: {
			gwta: 'Scenario: {scenario}',
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
			action: (({ result }: { result: string }) => (result.toUpperCase() === 'OK' ? actionOK({ messageContext: endExecutonContext }) : actionNotOK('ends with not ok'))),
		},
		showSteppers: {
			exact: 'show steppers',
			action: () => {
				const allSteppers = formattedSteppers(this.steppers);
				this.world?.logger.info(`Steppers: ${JSON.stringify(allSteppers, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { steppers: allSteppers } } });
			},
		},
		showSteps: {
			gwta: 'show step results',
			action: () => {
				const steps = this.getWorld().runtime.stepResults;
				this.world?.logger.info(`Steps: ${JSON.stringify(steps, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { steps } } });
			}
		},
		showFeatures: {
			gwta: 'show features',
			action: () => {
				this.world?.logger.info(`Features: ${JSON.stringify(this.resolvedFeature, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { features: this.resolvedFeature } } });
			}
		},
		showBackgrounds: {
			gwta: 'show backgrounds',
			action: () => {
				this.world?.logger.info(`Backgrounds: ${JSON.stringify(this.getWorld().runtime.backgrounds, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { backgrounds: this.getWorld().runtime.backgrounds } } });
			}
		},
		pauseSeconds: {
			gwta: 'pause for {ms:number}s',
			action: (async ({ ms }: { ms: number }) => { await sleep(ms * 1000); return OK; }),
		},
		showDomains: {
			gwta: 'show domains',
			action: () => {
				this.getWorld().logger.info(`Domains: ${JSON.stringify(this.getWorld().domains, null, 2)}`);
				return OK;
			}
		},
		comment: {
			gwta: ';;{comment}',
			action: () => OK,
		},
		afterEveryStepper: {
			precludes: [`Haibun.prose`],
			gwta: `after every {stepperName: string}, {statement: ${DOMAIN_STATEMENT}}`,
			action: ({ stepperName, statement }: { stepperName: string; statement: TFeatureStep[] }) => {
				this.afterEverySteps[stepperName] = statement;
				return OK;
			},
		},
	} satisfies TStepperSteps;
}
export default Haibun;
