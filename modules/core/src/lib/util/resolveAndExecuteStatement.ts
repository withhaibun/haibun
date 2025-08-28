import { getActionableStatement } from '../../phases/Resolver.js';
import { FeatureExecutor } from '../../phases/Executor.js';
import { AStepper } from '../astepper.js';
import { TWorld, TStepResult, TFeature } from '../defs.js';
import { expandIncluded } from '../features.js';

export async function resolveAndExecuteStatement(statement: string, source: string, steppers: AStepper[], world: TWorld, startSeq?: number, runOnly = true): Promise<TStepResult> {
	try {
		const bgMatch = statement.match(/^Backgrounds:\s*(.*)$/i);
		if (bgMatch) {
			return await executeBackgrounds(bgMatch[1].trim(), source, steppers, world, startSeq, runOnly);
		}
		const { featureStep } = await getActionableStatement(steppers, statement, source, startSeq);
		const result = await FeatureExecutor.doFeatureStep(steppers, featureStep, world, runOnly);
		return result;
	} catch (e) {
		throw new Error(`No feature step found for statement: "${statement}": ${e.message}`);
	}
}

async function executeBackgrounds(names: string, source: string, steppers: AStepper[], world: TWorld, startSeq: number, runOnly: boolean): Promise<TStepResult> {
	if (!world.runtime.backgrounds) {
		throw new Error('runtime.backgrounds is undefined; cannot expand inline Backgrounds');
	}
	// Build a temporary feature to reuse expandIncluded logic
	const backgroundFeature: TFeature = { path: source, base: '<inline>', name: 'inline-backgrounds', content: `Backgrounds: ${names}` };
	const expanded = await expandIncluded(backgroundFeature, world.runtime.backgrounds);
	let lastResult: TStepResult | undefined = undefined;
	let sub = 0;
	for (const x of expanded) {
		const { featureStep } = await getActionableStatement(steppers, x.line, x.feature.path, startSeq, sub);
		lastResult = await FeatureExecutor.doFeatureStep(steppers, featureStep, world, runOnly);
		world.runtime.stepResults.push(lastResult);
		if (!lastResult.ok) return lastResult;
		sub += .1;
	}
	// If no lines were found, error for clarity
	if (!expanded.length) {
		throw new Error(`No background lines found for: ${names}`);
	}
	return lastResult!;
}
