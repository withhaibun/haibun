import type { TWorld } from "./lib/world.js";
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

			// Collect domain concerns before Expand so domains are available during resolution
			await phaseRunner.tryPhase("Concerns", () => addStepperConcerns(this.world, this.steppers));

			// A run refuses to start with a blocking finding in its step graph, and reports the rest.
			await phaseRunner.tryPhase("StepGraph", () => {
				const report = lintRunStepGraph(this.steppers, this.world.domains);
				this.world.eventLogger.emit({
					id: DOMAIN_CHAIN_LINT_ARTIFACT,
					timestamp: Date.now(),
					source: "haibun",
					kind: "artifact",
					artifactType: "json",
					mimetype: "application/json",
					level: "debug",
					json: { domainChainLint: report },
				});
			});

			// A monitor formats the console for a person, so the raw event stream is suppressed for it. A run asked for
			// NDJSON is being read by another process, which doesn't have another stream to read, so that request outranks it.
			await phaseRunner.tryPhase("Options", () => {
				if (this.steppers.some((s) => s.kind === StepperKinds.MONITOR) && this.world.eventLogger && !this.world.eventLogger.ndjsonForced) {
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
