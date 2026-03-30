import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { IStepperCycles, TEndFeature, TFeatureStep, TWorld } from '../lib/defs.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { featureSyntheticSeqPath } from '../phases/Executor.js';
import { OK } from '../schema/protocol.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { actionNotOK } from '../lib/util/index.js';

export default class FinalizerStepper extends AStepper implements IHasCycles {
	description = 'Runs registered finalizer statements at end of execution';

	flowRunner: FlowRunner;
	registeredStatementsByFeature: Map<string, string[]> = new Map();

	private async runFinalizersForFeature(featurePath: string) {
		const statements = this.registeredStatementsByFeature.get(featurePath);
		if (statements && statements.length > 0) {
			const featureNum = this.getWorld().tag.featureNum;
			for (const [index, statement] of statements.entries()) {
				const result = await this.flowRunner.runStatement(statement, {
					seqPath: featureSyntheticSeqPath(featureNum, index + 1),
					intent: { mode: 'authoritative' },
				});

				if (!result.ok) {
					this.getWorld().eventLogger.warn(
						`finalizer-stepper: statement failed: ${statement} :: ${result.errorMessage || 'unknown error'}`
					);
				}
			}
		}

		this.registeredStatementsByFeature.delete(featurePath);
	}

	cycles: IStepperCycles = {
		startExecution: () => {
			this.registeredStatementsByFeature = new Map();
		},
		startFeature: ({ resolvedFeature }) => {
			if (!this.registeredStatementsByFeature.has(resolvedFeature.path)) {
				this.registeredStatementsByFeature.set(resolvedFeature.path, []);
			}
		},
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.featurePath) return;
			await this.runFinalizersForFeature(endFeature.featurePath);
		},
		endExecution: async () => {
			for (const featurePath of this.registeredStatementsByFeature.keys()) {
				await this.runFinalizersForFeature(featurePath);
			}
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.flowRunner = new FlowRunner(world, steppers);
	}

	steps: TStepperSteps = {
		registerFinalizer: {
			gwta: `finalizer {statement:${DOMAIN_STATEMENT}}`,
			action: (_: unknown, featureStep: TFeatureStep) => {
				const statement = featureStep.action?.stepValuesMap?.statement?.term?.trim();
				if (!statement) {
					return actionNotOK('finalizer statement is required');
				}
				const featurePath = this.getWorld().runtime.currentFeaturePath || featureStep.source.path;
				const statements = this.registeredStatementsByFeature.get(featurePath) || [];
				statements.push(statement);
				this.registeredStatementsByFeature.set(featurePath, statements);
				return OK;
			},
		},
	};
}