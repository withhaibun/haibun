import { FeatureExecutor } from '../../phases/Executor.js';
import { getActionableStatement } from '../../phases/Resolver.js';
import { AStepper } from '../astepper.js';
import { TWorld, TStepResult } from '../defs.js';

export async function resolveAndExecuteStatement(statement: string, source: string, steppers: AStepper[], world: TWorld): Promise<TStepResult> {
	const { featureStep } = await getActionableStatement(steppers, statement, source);
	return await FeatureExecutor.doFeatureStep(steppers, featureStep, world);
}
