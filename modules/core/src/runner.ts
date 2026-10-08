import type { TWorld } from "./lib/world.js";
import { MEDIA_TYPE } from "./lib/media-types.js";
import { TExecutorResult } from "./schema/protocol.js";
import { AStepper, StepperKinds, CStepper } from "./lib/astepper.js";
import { expand } from "./lib/features.js";
import { createSteppers, setStepperWorldsAndDomains } from "./lib/util/index.js";
import { TFeaturesBackgrounds } from "./phases/collector.js";
import { Executor, addStepperConcerns } from "./phases/Executor.js";
import { Resolver } from "./phases/Resolver.js";
import { PhaseBailError, PhaseRunner } from "./lib/PhaseRunner.js";
import { DOMAIN_CHAIN_LINT_ARTIFACT, lintRunStepGraph } from "./lib/domain-chain-lint.js";

export class Runner {
	steppers: AStepper[] = [];
	constructor(private world: TWorld) {}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], featuresBackgrounds: TFeaturesBackgrounds): Promise<TExecutorResult> {
		const phaseRunner = new PhaseRunner(this.world);

		try {
			this.steppers = await phaseRunner.tryPhase("Steppers", () => createSteppers(csteppers));
			phaseRunner.steppers = this.steppers;

			await phaseRunner.tryPhase("WorldsAndDomains", () => setStepperWorldsAndDomains(this.steppers, this.world));

			// The StepGraph phase and execution read the domains that addStepperConcerns registers.
			await phaseRunner.tryPhase("Concerns", () => addStepperConcerns(this.world, this.steppers));

			// A blocking finding in the step graph prevents execution. lintRunStepGraph throws on it.
			// The phase emits the report of non-blocking findings as a debug artifact.
			await phaseRunner.tryPhase("StepGraph", () => {
				const report = lintRunStepGraph(this.steppers, this.world.domains);
				this.world.eventLogger.emit({
					id: DOMAIN_CHAIN_LINT_ARTIFACT,
					timestamp: Date.now(),
					source: "haibun",
					kind: "artifact",
					artifactType: "json",
					mimetype: MEDIA_TYPE.json,
					level: "debug",
					json: { domainChainLint: report },
				});
			});

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
