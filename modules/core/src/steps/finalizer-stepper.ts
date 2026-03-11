import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { IStepperCycles, TFeatureStep, TWorld } from '../lib/defs.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { OK } from '../schema/protocol.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { actionNotOK } from '../lib/util/index.js';

export default class FinalizerStepper extends AStepper implements IHasCycles {
	description = 'Runs registered finalizer statements at end of execution';

	flowRunner: FlowRunner;
	registeredStatementsByFeature: Map<string, string[]> = new Map();
	activeFeaturePath?: string;

	private async runFinalizersForFeature(featurePath: string) {
		const statements = this.registeredStatementsByFeature.get(featurePath);
		if (statements && statements.length > 0) {
			for (const [index, statement] of statements.entries()) {
				const result = await this.flowRunner.runStatement(statement, {
					seqPath: [998, index + 1],
					intent: { mode: 'authoritative' },
				});

				if (result.kind !== 'ok') {
					this.getWorld().eventLogger.warn(
						`finalizer-stepper: statement failed: ${statement} :: ${result.message || 'unknown error'}`
					);
				}
			}
		}

		this.registeredStatementsByFeature.delete(featurePath);
	}

	cycles: IStepperCycles = {
		startExecution: () => {
			this.registeredStatementsByFeature = new Map();
			this.activeFeaturePath = undefined;
		},
		startFeature: ({ resolvedFeature }) => {
			this.activeFeaturePath = resolvedFeature.path;
			if (!this.registeredStatementsByFeature.has(resolvedFeature.path)) {
				this.registeredStatementsByFeature.set(resolvedFeature.path, []);
			}
		},
		endFeature: async () => {
			if (!this.activeFeaturePath) {
				return;
			}
			await this.runFinalizersForFeature(this.activeFeaturePath);
			this.activeFeaturePath = undefined;
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