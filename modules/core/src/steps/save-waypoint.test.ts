/**
 * A waypoint that `save waypoint` saves. Actuality registers it as a step at once, and its activity runs the saved lines.
 * Saving is refused where a line doesn't resolve to a step or the outcome is already registered with other lines.
 */
import { describe, it, expect } from "vitest";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { AStepper, type TFeatureStep } from "../lib/steps/domains/stepper.js";
import { actionOK } from "../lib/domains/util.js";
import { buildFeatureStepForTransport } from "../lib/steps/pipelines/call-step.js";
import { runRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import { dispatchStep } from "../lib/actuality/pipelines/step-dispatch.js";
import ActivitiesStepper, { SAVED_WAYPOINT_LABEL } from "./activities-stepper.js";
import AuthorityStepper from "./authority-stepper.js";
import { ACTIVITIES_ACTIONS, ACTIVITIES_STEPPER } from "./domains/activities-actions.js";
import { readAction, requiredAction } from "../lib/domains/actions.js";
import { Access } from "../lib/domains/resources.js";
import VariablesStepper from "./variables-stepper.js";
import { readEvery } from "../lib/records/pipelines/record-reads.js";

const OUTCOME = "Knock twice";
const KNOCK_LINE = 'set knocks to "2"';
const SAVE = `save waypoint "${OUTCOME}" doing [${JSON.stringify(KNOCK_LINE)}]`;
const RUN = ACTIVITIES_ACTIONS.runSavedWaypoint;
const SET = requiredAction(VariablesStepper.name, "set", {});
const READS_PUBLIC = readAction(Access.public);

/** Holds whether actuality offered the saved waypoint, and whether a transport-style call to it passed. */
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
const STEPPERS = [ActivitiesStepper, VariablesStepper, AuthorityStepper, SavedWaypointProbe];

describe("a waypoint a step saves", () => {
	it("is offered as a step at once, and runs its saved lines", async () => {
		expect(ActivitiesStepper.name, "the stepper is named as its actions name it").toBe(ACTIVITIES_STEPPER);
		await passWithDefaults(`${SAVE}\ncall the saved waypoint\nvariable knocks is "2"\n`, STEPPERS);
		expect(seen.offered, "actuality offers the outcome without a restart").toBe(true);
		expect(seen.ran).toBe(true);
	});

	it("is kept as a record stating its outcome and its lines", async () => {
		const { world } = await passWithDefaults(SAVE, STEPPERS);
		expect(await readEvery(world.shared.getStore(), { label: SAVED_WAYPOINT_LABEL })).toMatchObject([{ id: OUTCOME, lines: [KNOCK_LINE] }]);
	});

	it("requires the action every saved waypoint requires, and each of its lines requires its own", async () => {
		const holding = (actions: string[]) => `holding only "${actions.join(",")}", run the saved waypoint "${OUTCOME}"`;
		expect((await passWithDefaults(`${SAVE}\n${holding([RUN, SET, READS_PUBLIC])}\nvariable knocks is "2"\n`, STEPPERS)).ok, "a caller holding both").toBe(true);
		const withoutRun = await failWithDefaults(`${SAVE}\n${holding([SET])}\n`, STEPPERS);
		expect(JSON.stringify(withoutRun.featureResults?.[0]?.stepResults), "a caller that doesn't hold the action that runs a saved waypoint").toContain(RUN);
		const withoutLine = await failWithDefaults(`${SAVE}\n${holding([RUN])}\n`, STEPPERS);
		expect(JSON.stringify(withoutLine.featureResults?.[0]?.stepResults), "a caller that doesn't hold a line's action").toContain(SET);
	});

	it("isn't run where the outcome isn't a waypoint saved here", async () => {
		const unsaved = await failWithDefaults(`run the saved waypoint "${OUTCOME}"\n`, STEPPERS);
		expect(JSON.stringify(unsaved.featureResults?.[0]?.stepResults)).toContain(`\\"${OUTCOME}\\" isn't a waypoint saved here`);
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
