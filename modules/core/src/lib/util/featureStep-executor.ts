import { getActionableStatement } from '../../phases/Resolver.js';
import { FeatureExecutor, incSeqPath } from '../../phases/Executor.js';
import { AStepper } from '../astepper.js';
import { TWorld, TStepResult, TFeature, TFeatureStep, ExecMode } from '../defs.js';
import { expandLine } from '../features.js';

export async function resolveAndExecuteStatement(statement: string, base: string, steppers: AStepper[], world: TWorld, execMode: ExecMode, seqStart: number[]): Promise<TStepResult> {
	const featureSteps = findFeatureStepsFromStatement(statement, steppers, world, base, seqStart);
	return await executeFeatureSteps(featureSteps, steppers, world, execMode);
}

export async function executeSubFeatureSteps(superFeatureStep: TFeatureStep, featureSteps: TFeatureStep[], steppers: AStepper[], world: TWorld, execMode: ExecMode = ExecMode.WITH_CYCLES, dir = 1): Promise<TStepResult> {
	let lastResult: TStepResult;

	for (const step of featureSteps) {
		// Calculate seqPath for this step based on current state of stepResults
		const baseSeqPath = [...superFeatureStep.seqPath, 1];
		const seqPath = incSeqPath(world.runtime.stepResults, baseSeqPath, dir);
		const mappedStep = { ...step, seqPath };

		// Execute the step
		lastResult = await FeatureExecutor.doFeatureStep(steppers, mappedStep, world, execMode);

		// Push to stepResults if not already pushed (doFeatureStep pushes when WITH_CYCLES)
		if (execMode !== ExecMode.WITH_CYCLES) {
			world.runtime.stepResults.push(lastResult);
		}

		if (!lastResult.ok) {
			return lastResult;
		}
	}

	return lastResult;
}

export async function executeFeatureSteps(featureSteps: TFeatureStep[], steppers: AStepper[], world: TWorld, execMode: ExecMode = ExecMode.WITH_CYCLES): Promise<TStepResult> {
	let lastResult: TStepResult;

	for (const x of featureSteps) {
		lastResult = await FeatureExecutor.doFeatureStep(steppers, x, world, execMode);
		
		// Push to stepResults if not already pushed (doFeatureStep pushes when WITH_CYCLES)
		if (execMode !== ExecMode.WITH_CYCLES) {
			world.runtime.stepResults.push(lastResult);
		}

		if (!lastResult.ok) {
			return lastResult;
		}
	}
	return lastResult;
}

export function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string, seqStart: number[], inc = 1): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error('runtime.backgrounds is undefined; cannot expand inline Backgrounds');
	}
	const backgroundFeature: TFeature = { path: `<from ${statement}>`, base, name: 'inline-backgrounds', content: `Backgrounds: ${statement}` };
	const expanded = expandLine(statement, world.runtime.backgrounds, backgroundFeature);
	// Increment the last segment of seqStart by inc for each expanded step
	const prefix = seqStart.slice(0, -1);
	let latest = seqStart[seqStart.length - 1];
	for (const x of expanded) {
		const seqPath = [...prefix, latest];
		const { featureStep } = getActionableStatement(steppers, x.line, x.feature.path, seqPath);
		latest += inc;
		featureSteps.push(featureStep);
	}
	return featureSteps;
}
