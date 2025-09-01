import { getActionableStatement } from '../../phases/Resolver.js';
import { FeatureExecutor } from '../../phases/Executor.js';
import { AStepper } from '../astepper.js';
import { TWorld, TStepResult, TFeature, TFeatureStep } from '../defs.js';
import { expandLine } from '../features.js';

export async function resolveAndExecuteStatementWithCycles(names: string, base: string, steppers: AStepper[], world: TWorld, startSeq?: number): Promise<TStepResult> {
	return await doResolveAndExecuteStatement(names, base, steppers, world, startSeq, false);
}

export async function resolveAndExecuteStatement(names: string, base: string, steppers: AStepper[], world: TWorld): Promise<TStepResult> {
	return await doResolveAndExecuteStatement(names, base, steppers, world, null, true);
}

async function doResolveAndExecuteStatement(names: string, base: string, steppers: AStepper[], world: TWorld, startSeq: number, noCycles: boolean): Promise<TStepResult> {
	const featureSteps = await findFeatureStepsFromStatement(names, steppers, world, base, startSeq);
	let lastResult;
	for (const x of featureSteps) {
		lastResult = await FeatureExecutor.doFeatureStep(steppers, x, world, noCycles);
		if (!noCycles) {
			world.runtime.stepResults.push(lastResult);
		}
		if (!lastResult.ok) return lastResult;
	}
	return lastResult!;
}

export async function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string, startSeq: number, sub = 0): Promise<TFeatureStep[]> {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error('runtime.backgrounds is undefined; cannot expand inline Backgrounds');
	}
	// temporary feature for expandLine
	const backgroundFeature: TFeature = { path: `from ${statement}`, base, name: 'inline-backgrounds', content: `Backgrounds: ${statement}` };
	const expanded = expandLine(statement, world.runtime.backgrounds, backgroundFeature);
	for (const x of expanded) {
		sub += .1;
		const { featureStep } = await getActionableStatement(steppers, x.line, x.feature.path, startSeq, sub);
		featureSteps.push(featureStep);
	}
	return featureSteps;
}
