/** A feature's narration: the audio of each line the narrator speaks, its prose and its feature and scenario headings. */
import type { TResolvedFeature } from "../../lib/steps/domains/stepper.js";
import { FEATURE_START, SCENARIO_START, isPendingScenario } from "../../lib/domains/protocol.js";
import type { TRenderedAudioMap, TSpeech } from "../ports.js";

/** The headings the narrator speaks beside prose. A pending scenario's heading isn't spoken. */
const SPOKEN_HEADINGS = [SCENARIO_START, FEATURE_START];

/** The audio of each line of `feature` that the narrator speaks. */
export function narratedAudio(speech: TSpeech, feature: TResolvedFeature): Promise<TRenderedAudioMap> {
	const spoken = feature.featureSteps.filter((step) => step.action.step.prose || (SPOKEN_HEADINGS.includes(step.action.actionName) && !isPendingScenario(step.in)));
	return speech.rendered(new Set(spoken.map((step) => step.in)));
}
