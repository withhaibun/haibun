import { TFeatureStep, TWorld, IStepperCycles, TFeatures, TResolvedFeature, TStartExecution, TStartFeature, CycleWhen } from '../lib/defs.js';
import { OK, STEP_DELAY } from '../schema/protocol.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK, formattedSteppers, sleep } from '../lib/util/index.js';
import { findFeatureStepsFromStatement } from '../phases/Resolver.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { findFeatures } from '../lib/features.js';
import { FlowRunner } from '../lib/core/flow-runner.js';


class Haibun extends AStepper implements IHasCycles {
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
				const expanded = findFeatureStepsFromStatement(names, this.steppers, world, featureStep.path, featureStep.seqPath, 1);
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
				return actionOK();
			},
		},
		showSteps: {
			gwta: 'show step results',
			action: () => {
				const steps = this.getWorld().runtime.stepResults;
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
