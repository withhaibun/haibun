import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { IStepperCycles, TFeatureStep, TWorld } from '../lib/defs.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { OK } from '../schema/protocol.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { actionNotOK } from '../lib/util/index.js';

export default class FinalizerStepper extends AStepper implements IHasCycles {
	description = 'Runs registered finalizer statements at end of execution';

	flowRunner: FlowRunner;
	registeredStatements: string[] = [];
	cycles: IStepperCycles = {
		startExecution: () => {
			this.registeredStatements = [];
		},
		endExecution: async () => {
			if (this.registeredStatements.length === 0) {
				return;
			}

			for (const [index, statement] of this.registeredStatements.entries()) {
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
				this.registeredStatements.push(statement);
				return OK;
			},
		},
	};
}