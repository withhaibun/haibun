import { OK, TFeatureStep, STEP_DELAY, TStepArgs, TWorld, ExecMode } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, actionOK, formattedSteppers, sleep } from '../lib/util/index.js';
import { doExecuteFeatureSteps } from '../lib/util/featureStep-executor.js';
import { expand } from '../lib/features.js';
import { asFeatures } from '../lib/resolver-features.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';
import { endExecutonContext } from '../phases/Executor.js';

class Haibun extends AStepper {
	steppers: AStepper[] = [];
	// eslint-disable-next-line @typescript-eslint/require-await
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
	}

	steps = {
		prose: {
			match: /.+[.!?]$/,
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
		not: {
			gwta: 'not {what:statement}',
			action: async ({ what }: TStepArgs, featureStep: TFeatureStep) => {

				const list = <TFeatureStep[]>what;
				let last;
				for (let i = 0; i < list.length; i++) {
					const nested = { ...list[i], seqPath: [...featureStep.seqPath, i + 1] };
					last = await doExecuteFeatureSteps([nested], this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
					this.getWorld().runtime.stepResults.push(last);
					if (!last.ok) break;
				}
				if (!last) return actionNotOK('not statement empty');
				return last.ok ? actionNotOK('not statement was true') : OK;
			},
		},
		if: {
			gwta: 'if {when:statement}, {what:statement}',
			action: async ({ when, what }: TStepArgs, featureStep: TFeatureStep) => {
				const whenList = Array.isArray(when) ? when : [];
				const whenNested = whenList.map((s, i) => ({ ...s, seqPath: [...featureStep.seqPath, i + 1] }));
				const whenResult = await doExecuteFeatureSteps(whenNested, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
				if (!whenResult.ok) return OK;
				const whatList = Array.isArray(what) ? what : [];
				const offset = whenNested.length + 1;
				let accumulatedOK = true;
				for (let i = 0; i < whatList.length; i++) {
					const nested = { ...whatList[i], seqPath: [...featureStep.seqPath, offset + i] };
					const res = await doExecuteFeatureSteps([nested], this.steppers, this.getWorld(), ExecMode.CYCLES);
					if (!res.ok) { accumulatedOK = false; break; }
				}
				return accumulatedOK ? OK : actionNotOK('if body failed');
			},
		},
		startStepDelay: {
			gwta: 'step delay of {ms:number}ms',
			action: ({ ms }: TStepArgs) => {
				this.getWorld().options[STEP_DELAY] = ms as number;
				return OK;
			},
		},
		endsWith: {
			gwta: 'ends with {result}',
			action: ({ result }: TStepArgs) => (String(result).toUpperCase() === 'OK' ? actionOK({ messageContext: endExecutonContext }) : actionNotOK('ends with not ok')),
			checkAction: ({ result }: TStepArgs) => {
				if (['OK', 'NOT OK'].includes(((<string>result).toUpperCase()))) return true;
				throw Error('must be "OK" or "not OK"');
			}
		},
		showSteps: {
			exact: 'show steppers',
			action: () => {
				const allSteppers = formattedSteppers(this.steppers);
				this.world?.logger.info(`Steppers: ${JSON.stringify(allSteppers, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { steppers: allSteppers } } });
			},
		},
		showCompletedSteps: {
			exact: 'show completed steps',
			action: () => {
				const completedSteps = this.getWorld().runtime.stepResults || [];
				const steps = completedSteps.map((step, idx) => {
					const timing = step.stepActionResult.end! - step.stepActionResult.start!;
					const status = step.ok ? '✅' : '❌';
					return { index: idx + 1, status, step: step.in, timing: `${timing}ms` };
				});
				this.world?.logger.info(`Completed ${completedSteps.length} step(s): ${JSON.stringify(steps, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { completedSteps: steps, count: completedSteps.length } } });
			},
		},
		until: {
			gwta: 'until {what} is {value}',
			action: async ({ what, value }: TStepArgs) => { const key = String(what); while (this.getWorld().shared.get(key) !== value) { await sleep(100); } return OK; },
		},
		pauseSeconds: {
			gwta: 'pause for {ms:number}s',
			action: async ({ ms }: TStepArgs) => { await sleep((ms as number) * 1000); return OK; },
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
			gwta: 'after every {stepperName}, {line}',
			action: () => OK,
			applyEffect: async ({ stepperName, line }: TStepArgs, currentFeatureStep: TFeatureStep, steppers: AStepper[]) => {
				const newSteps: TFeatureStep[] = [currentFeatureStep];
				if (typeof stepperName === 'string' && currentFeatureStep.action.stepperName === stepperName) {
					const newFeatureStep = await this.newFeatureFromEffect(String(line), currentFeatureStep.seqPath, steppers);
					newSteps.push(newFeatureStep);
				}
				return newSteps;
			},
		},
	};

	async newFeatureFromEffect(content: string, parentSeqPath: number[], steppers: AStepper[]): Promise<TFeatureStep> {
		const features = asFeatures([{ path: `resolved from ${content}`, content }]);
		const expandedFeatures = await expand({ backgrounds: [], features });
		const featureSteps = await new Resolver(steppers).findFeatureSteps(expandedFeatures[0]);
		return { ...featureSteps[0], seqPath: [...parentSeqPath, 1] };
	}
}

export default Haibun;
