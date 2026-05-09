import type { TWorld } from "./lib/world.js";
import { TExecutorResult } from "./schema/protocol.js";
import { AStepper, StepperKinds, CStepper } from "./lib/astepper.js";
import { expand } from "./lib/features.js";
import { createSteppers, setStepperWorldsAndDomains } from "./lib/util/index.js";
import { TFeaturesBackgrounds } from "./phases/collector.js";
import { Executor, addStepperConcerns } from "./phases/Executor.js";
import { Resolver } from "./phases/Resolver.js";
import { PhaseBailError, PhaseRunner } from "./lib/PhaseRunner.js";

export class Runner {
	steppers: AStepper[];
	constructor(private world: TWorld) {}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], featuresBackgrounds: TFeaturesBackgrounds): Promise<TExecutorResult> {
		const phaseRunner = new PhaseRunner(this.world);

		try {
			this.steppers = await phaseRunner.tryPhase("Steppers", () => createSteppers(csteppers));
			phaseRunner.steppers = this.steppers;

			await phaseRunner.tryPhase("WorldsAndDomains", () => setStepperWorldsAndDomains(this.steppers, this.world));

			// Collect domain concerns before Expand so domains are available during resolution
			await phaseRunner.tryPhase("Concerns", () => addStepperConcerns(this.world, this.steppers));

			// Auto-suppress NDJSON output if any monitor stepper is configured
			await phaseRunner.tryPhase("Options", () => {
				if (this.steppers.some((s) => s.kind === StepperKinds.MONITOR) && this.world.eventLogger) {
					this.world.eventLogger.suppressConsole = true;
				}
				// Make backgrounds available at runtime for inline `Backgrounds:` expansion
				this.world.runtime.backgrounds = featuresBackgrounds.backgrounds;
			});

			const expandedFeatures = await phaseRunner.tryPhase("Expand", () => expand(featuresBackgrounds));

			const resolver = new Resolver(this.steppers, featuresBackgrounds.backgrounds);
			const resolvedFeatures = await phaseRunner.tryPhase("Resolve", () => resolver.resolveStepsFromFeatures(expandedFeatures));

			return await phaseRunner.tryPhase("Execute", () => Executor.executeFeatures(this.steppers, this.world, resolvedFeatures));
		} catch (error) {
			if (error instanceof PhaseBailError) {
				return error.result;
			}
			throw error;
		}
	}
}
