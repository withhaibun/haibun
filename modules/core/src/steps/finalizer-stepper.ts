import { actionNotOK } from "../lib/util/index.js";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles, TEndFeature, TFeatureStep } from "../lib/astepper.js";
import type { TWorld } from "../lib/world.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { featureSyntheticSeqPath } from "../phases/Executor.js";
import { OK } from "../schema/protocol.js";
import { DOMAIN_STATEMENT } from "../lib/domains.js";

export default class FinalizerStepper extends AStepper implements IHasCycles {
	description = "Runs registered finalizer statements at end of execution";

	private held?: FlowRunner;
	get flowRunner(): FlowRunner {
		return this.madeWithWorld(this.held, "flow runner");
	}
	registeredStatementsByFeature: Map<string, string[]> = new Map();

	private async runFinalizersForFeature(featurePath: string) {
		const statements = this.registeredStatementsByFeature.get(featurePath);
		if (statements && statements.length > 0) {
			const { featureNum, hostId } = this.getWorld().tag;
			for (const [index, statement] of statements.entries()) {
				const result = await this.flowRunner.runStatement(statement, {
					seqPath: featureSyntheticSeqPath(featureNum, index + 1, 0, hostId),
					intent: { mode: "authoritative" },
				});

				if (!result.ok) {
					this.getWorld().eventLogger.warn(`finalizer-stepper: statement failed: ${statement} :: ${result.errorMessage || "unknown error"}`);
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
		this.held = new FlowRunner(world, steppers);
	}

	steps = {
		registerFinalizer: {
			gwta: `finalizer {statement:${DOMAIN_STATEMENT}}`,
			action: ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const featurePath = this.getWorld().runtime.currentFeaturePath || featureStep.source?.path;
				if (!featurePath) return actionNotOK("a finalizer runs when its feature ends, and this step doesn't run in a feature");
				const statements = this.registeredStatementsByFeature.get(featurePath) || [];
				statements.push(...statement.map((step) => step.in));
				this.registeredStatementsByFeature.set(featurePath, statements);
				return OK;
			},
		},
	} satisfies TStepperSteps;
}
