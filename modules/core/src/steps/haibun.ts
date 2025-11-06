import { OK, TFeatureStep, STEP_DELAY, TWorld, ExecMode, TStepResult, TCheckAction, IStepperCycles } from '../lib/defs.js';
import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK, formattedSteppers, sleep } from '../lib/util/index.js';
import { executeSubFeatureSteps } from '../lib/util/featureStep-executor.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';
import { endExecutonContext } from '../phases/Executor.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';

class Haibun extends AStepper {
	afterEverySteps: { [stepperName: string]: TFeatureStep[] } = {};
	steppers: AStepper[] = [];
	// eslint-disable-next-line @typescript-eslint/require-await
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
	}
	cycles: IStepperCycles = {
		// add a cycle that processes any afterEvery effects after each step
		afterStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
			const afterEvery = this.afterEverySteps[featureStep.action.stepperName];
			let failed = false;
			if (afterEvery) {
				for (const aeStep of afterEvery) {
					// Map the seqPath to extend from the current featureStep
					const mappedStep: TFeatureStep = {
						...aeStep,
						seqPath: [...featureStep.seqPath, ...(aeStep.seqPath.slice(1))],
					};
					const res = await executeSubFeatureSteps(featureStep, [mappedStep], this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
					if (!res.ok) {
						failed = true;
						break;
					}
				}
			}
			return Promise.resolve({ failed });
		}
	};

	steps: TStepperSteps = {
		// --- LOGIC PRIMITIVES (FLOW CONTROL) ---

		// Represents Logical Negation (~P).
		not: {
			gwta: `not {statements:${DOMAIN_STATEMENT}}`,
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const lastResult = await executeSubFeatureSteps(featureStep, statements, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

				// Negation: action is OK if the inner statement failed (was NOT true)
				return lastResult.ok ? actionNotOK('not statement was true (failed negation)') : OK;
			},
		},

		// Represents Logical Implication (P => Q).
		if: {
			gwta: `if {ifStatements:${DOMAIN_STATEMENT}}, {thenStatements:${DOMAIN_STATEMENT}}`,
			action: async ({ ifStatements, thenStatements }: { ifStatements: TFeatureStep[], thenStatements: TFeatureStep[] }, featureStep: TFeatureStep) => {

				// 1. Evaluate Antecedent (WHEN)
				const ifResult = await executeSubFeatureSteps(featureStep, ifStatements, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

				// If antecedent fails, the implication is true (vacuously true: F => T/F), so we return OK.
				if (!ifResult.ok) {
					return OK;
				}

				// 2. Evaluate Consequent (THEN)
				const ifThenResult = await executeSubFeatureSteps(featureStep, thenStatements, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES);

				// Consequent must succeed to prove the implication is true (T => T)
				return ifThenResult.ok ? OK : actionNotOK('if antecedent was TRUE, but consequent failed');
			},
		},

		registerCondition: {
			description: 'Register the condition based on the provided argument, storing the result and proof in the execution runtime state.',
			gwta: 'register {condition: DOMAIN_STRING} with {proof: DOMAIN_STATEMENT}',
			action: (async ({ condition, proof }: { condition: string, proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const proofsPassed = await executeSubFeatureSteps(featureStep, proof, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES).then(res => res.ok);
				if (proofsPassed) {
					this.getWorld().runtime.condition.push({ condition, proof: proofsPassed });
					const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { proof: proofsPassed } };
					return actionOK({ messageContext });
				}
				return actionNotOK('tbd');
			}),
		},
		ensureCondition: {
			description: 'ensures a condition exists in the runtime state, or fails',
			gwta: `ensure {condition}`,
			action: (({ condition }: { condition: string }) => {
				const runtimeCondition = this.getWorld().runtime.condition.find(o => o.condition === condition);
				if (runtimeCondition) {
					const conditionProof: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { proof: runtimeCondition } };
					return actionOK({ messageContext: conditionProof });
				}
				return actionNotOK('tbd');
			}),
		},
		// --- META& UTILITIES ---
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

		prose: {
			match: /.+[.!?]$/,
			precludes: [`Haibun.and`, `Haibun.or`],
			action: async () => Promise.resolve(OK),
		},
		feature: {
			gwta: 'Feature: {feature}',
			action: async () => Promise.resolve(OK),
		},
		scenario: {
			gwta: 'Scenario: {scenario}',
			action: async () => Promise.resolve(OK),
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
			checkAction: (({ result }: { result: string }) => {
				if (['OK', 'NOT OK'].includes(result.toUpperCase())) return true;
				throw Error('must be "OK" or "not OK"');
			}) as TCheckAction,
		},
		showSteps: {
			exact: 'show steppers',
			action: () => {
				const allSteppers = formattedSteppers(this.steppers);
				this.world?.logger.info(`Steppers: ${JSON.stringify(allSteppers, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { steppers: allSteppers } } });
			},
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
			checkAction: () => {
				// this will throw an exception if statement isn't valid
				return true;
			},
		},
	};
}

export default Haibun;
