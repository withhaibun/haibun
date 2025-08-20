import { FeatureExecutor } from '../../phases/Executor.js';
import { getActionableStatement } from '../../phases/Resolver.js';
import { AStepper } from '../astepper.js';
import { TWorld, TStepResult } from '../defs.js';

export async function resolveAndExecuteStatement(statement: string, source: string, steppers: AStepper[], world: TWorld, runOnly = true): Promise<TStepResult> {
	try {
		const { featureStep } = await getActionableStatement(steppers, statement, source);
		return await FeatureExecutor.doFeatureStep(steppers, featureStep, world, runOnly);
	} catch (e) {
		throw new Error(`No feature step found for statement: "${statement}": ${e.message}`);
	}
}
