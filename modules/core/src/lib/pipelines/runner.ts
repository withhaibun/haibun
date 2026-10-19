import type { TWorld } from "../actuality/domains/world.js";
import { TExecutorResult } from "../domains/protocol.js";
import { AStepper, StepperKinds, CStepper } from "../steps/domains/stepper.js";
import { expand } from "../domains/features.js";
import { createSteppers, setStepperWorldsAndDomains } from "../domains/util.js";
import type { TFeaturesBackgrounds } from "../actuality/domains/execution.js";
import { Executor, addStepperConcerns } from "../actuality/pipelines/executor.js";
import { Resolver } from "../actuality/pipelines/resolver.js";
import { PhaseBailError, PhaseRunner } from "../steps/pipelines/phase-runner.js";

export class Runner {
	steppers: AStepper[] = [];
	constructor(private world: TWorld) {}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], featuresBackgrounds: TFeaturesBackgrounds): Promise<TExecutorResult> {
		const phaseRunner = new PhaseRunner(this.world);

		try {
			this.steppers = await phaseRunner.tryPhase("Steppers", () => createSteppers(csteppers));
			phaseRunner.steppers = this.steppers;

			await phaseRunner.tryPhase("WorldsAndDomains", () => setStepperWorldsAndDomains(this.steppers, this.world));

			// Execution reads the domains that addStepperConcerns registers.
			await phaseRunner.tryPhase("Concerns", () => addStepperConcerns(this.world, this.steppers));

			// The phase sets suppressConsole when a monitor stepper is loaded. The event logger doesn't write NDJSON events to the console while suppressConsole is set.
			// The phase doesn't set suppressConsole when ndjsonForced is true. The NDJSON option sets ndjsonForced for a calling process that reads the events.
			await phaseRunner.tryPhase("Options", () => {
				if (this.steppers.some((s) => s.kind === StepperKinds.MONITOR) && this.world.eventLogger && !this.world.eventLogger.ndjsonForced) {
					this.world.eventLogger.suppressConsole = true;
				}
				// findFeatureStepsFromStatement reads runtime.backgrounds to expand an inline `Backgrounds:` line during execution.
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
