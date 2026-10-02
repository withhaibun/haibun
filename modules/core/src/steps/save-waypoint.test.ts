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
import ActivitiesStepper, { SAVED_WAYPOINT_LABEL } from "./activities-stepper.js";
import VariablesStepper from "./variables-stepper.js";

const OUTCOME = "Knock twice";
const SAVE = `save waypoint "${OUTCOME}" doing ["set knocks to \\"2\\""]`;

/** Whether actuality offered the saved waypoint, and whether calling it as a transport does succeeded. */
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
/** The records of the waypoints an actuality saved, as a store that outlasts it holds them. */
const kept: Record<string, unknown>[] = [];

/** Reads the saved waypoints' records an actuality wrote, and writes them into a later actuality's store, as a store that
 *  outlasts a restart holds them. */
class KeptWaypointsProbe extends AStepper {
	description = "Keeps the saved waypoints' records across actualities, as a store that outlasts a restart does.";
	steps = {
		keepTheSavedWaypoints: {
			gwta: "keep the saved waypoints",
			action: async () => {
				kept.splice(0, kept.length, ...(await this.getWorld().shared.getStore().queryIndividuals(SAVED_WAYPOINT_LABEL)));
				return actionOK();
			},
		},
		holdTheKeptWaypoints: {
			gwta: "hold the kept waypoints",
			action: async () => {
				for (const record of kept) await this.getWorld().shared.getStore().upsertIndividual(SAVED_WAYPOINT_LABEL, record);
				return actionOK();
			},
		},
	};
}
const STEPPERS = [ActivitiesStepper, VariablesStepper, SavedWaypointProbe, KeptWaypointsProbe];

describe("a waypoint saved during a run", () => {
	it("is offered as a step at once, and runs the lines it was saved with", async () => {
		await passWithDefaults(`${SAVE}\ncall the saved waypoint\nvariable knocks is "2"\n`, STEPPERS);
		expect(seen.offered, "actuality offers the outcome without a restart").toBe(true);
		expect(seen.ran).toBe(true);
	});

	it("is kept as a record, and registered again from it after a restart", async () => {
		await passWithDefaults(`${SAVE}\nkeep the saved waypoints\n`, STEPPERS);
		expect(kept, "the record states the outcome and the lines").toMatchObject([{ id: OUTCOME, lines: ['set knocks to "2"'] }]);
		seen.offered = false;
		seen.ran = false;
		await passWithDefaults("hold the kept waypoints\nregister the saved waypoints\ncall the saved waypoint\nvariable knocks is \"2\"\n", STEPPERS);
		expect(seen.offered, "a later actuality offers the waypoint its store holds").toBe(true);
		expect(seen.ran).toBe(true);
	});

	it("is kept where it is saved again with the same lines", async () => {
		seen.ran = false;
		await passWithDefaults(`${SAVE}\n${SAVE}\ncall the saved waypoint\n`, STEPPERS);
		expect(seen.ran).toBe(true);
	});

	it("is refused where a line doesn't resolve to a step, and where the outcome is registered with other lines", async () => {
		const unresolved = await failWithDefaults(`save waypoint "Knock never" doing ["knock on nothing at all"]\n`, STEPPERS);
		expect(JSON.stringify(unresolved.featureResults?.[0]?.stepResults)).toContain("each line of a saved waypoint resolves to one step");
		const twice = await failWithDefaults(`${SAVE}\nsave waypoint "${OUTCOME}" doing ["set knocks to \\"3\\""]\n`, STEPPERS);
		expect(JSON.stringify(twice.featureResults?.[0]?.stepResults)).toContain(`the outcome \\"${OUTCOME}\\" is already registered`);
	});
});
