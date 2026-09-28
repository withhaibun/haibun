/**
 * A waypoint saved during a run: registered as a step the run offers at once, whose activity is the lines it was saved
 * with, and refused where a line doesn't resolve to a step or the outcome is already registered.
 */
import { describe, it, expect } from "vitest";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { AStepper, type TFeatureStep } from "../lib/astepper.js";
import { actionOK } from "../lib/util/index.js";
import { buildFeatureStepForTransport, runRegistry, stepMethodName } from "../lib/step-registry.js";
import { dispatchStep } from "../lib/step-dispatch.js";
import ActivitiesStepper from "./activities-stepper.js";
import VariablesStepper from "./variables-stepper.js";

const OUTCOME = "Knock twice";
const SAVE = `save waypoint "${OUTCOME}" doing ["set knocks to \\"2\\""]`;

/** Whether the run offered the saved waypoint, and whether calling it as a transport does succeeded. */
const seen = { offered: false, ran: false };

/** Calls the saved waypoint as a transport does. */
class SavedWaypointProbe extends AStepper {
	description = "Calls a saved waypoint as a transport does.";
	steps = {
		callTheSavedWaypoint: {
			gwta: "call the saved waypoint",
			action: async (_: unknown, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const registry = runRegistry(world);
				const tool = registry.get(stepMethodName(ActivitiesStepper.name, OUTCOME));
				seen.offered = tool !== undefined;
				if (tool)
					seen.ran = (
						await dispatchStep({ registry, world, steppers: world.runtime.steppers as AStepper[] }, buildFeatureStepForTransport(tool, {}, [...featureStep.seqPath, 1]))
					).ok;
				return actionOK();
			},
		},
	};
}
const STEPPERS = [ActivitiesStepper, VariablesStepper, SavedWaypointProbe];

describe("a waypoint saved during a run", () => {
	it("is offered as a step at once, and runs the lines it was saved with", async () => {
		await passWithDefaults(`${SAVE}\ncall the saved waypoint\nvariable knocks is "2"\n`, STEPPERS);
		expect(seen.offered, "the run offers the outcome without a restart").toBe(true);
		expect(seen.ran).toBe(true);
	});

	it("is refused where a line doesn't resolve to a step, and where the outcome is already registered", async () => {
		const unresolved = await failWithDefaults(`save waypoint "Knock never" doing ["knock on nothing at all"]\n`, STEPPERS);
		expect(JSON.stringify(unresolved.featureResults?.[0]?.stepResults)).toContain("each line of a saved waypoint resolves to one step");
		const twice = await failWithDefaults(`${SAVE}\n${SAVE}\n`, STEPPERS);
		expect(JSON.stringify(twice.featureResults?.[0]?.stepResults)).toContain(`the outcome \\"${OUTCOME}\\" is already registered`);
	});
});
