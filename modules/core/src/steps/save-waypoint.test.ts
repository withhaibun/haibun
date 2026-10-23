/**
 * A waypoint that `save waypoint` saves. Actuality states its rule at once, and its activity runs the saved lines. Saving is
 * refused where a line doesn't resolve to a step or the head is already registered with other lines.
 */
import { describe, it, expect } from "vitest";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { AStepper, type TFeatureStep } from "../lib/steps/domains/stepper.js";
import { actionOK } from "../lib/domains/util.js";
import { findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import { proveStatements, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import ActivitiesStepper, { SAVED_WAYPOINT_LABEL } from "./activities-stepper.js";
import AuthorityStepper from "./authority-stepper.js";
import { ACTIVITIES_ACTIONS, ACTIVITIES_STEPPER } from "./domains/activities-actions.js";
import { readAction, requiredAction } from "../lib/domains/actions.js";
import { Access } from "../lib/domains/resources.js";
import VariablesStepper from "./variables-stepper.js";
import { readEvery } from "../lib/records/pipelines/record-reads.js";
import { QuadStore, newStoreChain } from "../lib/steps/pipelines/quad-store.js";
import { readDeclarationsOf } from "../lib/records/derivations/read-records.js";

const OUTCOME = "Knock twice";
const KNOCK_LINE = 'set knocks to "2"';
const SAVE = `save waypoint "${OUTCOME}" doing [${JSON.stringify(KNOCK_LINE)}]`;
const RUN = ACTIVITIES_ACTIONS.runSavedWaypoint;
const SET = requiredAction(VariablesStepper.name, "set", {});
const READS_PUBLIC = readAction(Access.public);

/** Holds whether a line resolved after the save applied the saved waypoint, and whether its proof passed. */
const seen = { applied: false, ran: false };

/** Resolves the saved waypoint's head as a line and proves it, as a statement resolved after the save is. */
class SavedWaypointProbe extends AStepper {
	description = "Resolves a saved waypoint's head as a line and proves it.";
	steps = {
		applyTheSavedWaypoint: {
			gwta: "apply the saved waypoint",
			action: async (_: unknown, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const steppers = world.runtime.steppers as AStepper[];
				const statement = findFeatureStepsFromStatement(OUTCOME, steppers, world, undefined, [0]);
				seen.applied = statement.every((step) => step.action.actionName === "apply");
				seen.ran = (await proveStatements(stepperContext(world, steppers), featureStep, statement)).ok;
				return actionOK();
			},
		},
	};
}
const STEPPERS = [ActivitiesStepper, VariablesStepper, AuthorityStepper, SavedWaypointProbe];

describe("a waypoint a step saves", () => {
	it("states its rule at once, so a line resolved after it applies the waypoint and runs its saved lines", async () => {
		expect(ActivitiesStepper.name, "the stepper is named as its actions name it").toBe(ACTIVITIES_STEPPER);
		await passWithDefaults(`${SAVE}\napply the saved waypoint\nvariable knocks is "2"\n`, STEPPERS);
		expect(seen.applied, "actuality applies the head without a restart").toBe(true);
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

	it("states its rule from its record as a later actuality's first feature starts, and every later feature keeps it", async () => {
		const { world } = await passWithDefaults(SAVE, STEPPERS);
		const [record] = await readEvery(world.shared.getStore(), { label: SAVED_WAYPOINT_LABEL });
		/** Keeps saved waypoints in a store that outlasts each feature's, holding the record as actuality starts, as the store a
		 *  later process opens holds it. */
		class HoldsTheRecord extends AStepper {
			description = "Keeps saved waypoints in a store that outlasts each feature's, and holds a record in it as actuality starts.";
			steps = {};
			cycles = {
				startActuality: async () => {
					const store = this.getWorld().shared.getStore();
					if (!(store instanceof QuadStore)) throw new Error("the world's store isn't a QuadStore, which routes a graph to a backing store");
					const { domains } = this.getWorld();
					await store.registerStore(new QuadStore(newStoreChain(), undefined, () => readDeclarationsOf(domains)), [SAVED_WAYPOINT_LABEL]);
					await store.upsertIndividual(SAVED_WAYPOINT_LABEL, record as Record<string, unknown>);
				},
			};
		}
		const applying = { path: "/features/apply", content: "apply the saved waypoint" };
		seen.applied = false;
		await passWithDefaults([applying, { ...applying, path: "/features/apply-again" }], [...STEPPERS, HoldsTheRecord]);
		expect(seen.applied, "the second feature applies the waypoint the first feature's start stated").toBe(true);
	});

	it("is kept where it is saved again with the same lines", async () => {
		seen.ran = false;
		await passWithDefaults(`${SAVE}\n${SAVE}\napply the saved waypoint\n`, STEPPERS);
		expect(seen.ran).toBe(true);
	});

	it("is refused where a line doesn't resolve to a step, and where the outcome is registered with other lines", async () => {
		const unresolved = await failWithDefaults(`save waypoint "Knock never" doing ["knock on nothing at all"]\n`, STEPPERS);
		expect(JSON.stringify(unresolved.featureResults?.[0]?.stepResults)).toContain("each line of a saved waypoint resolves to one step");
		const twice = await failWithDefaults(`${SAVE}\nsave waypoint "${OUTCOME}" doing ["set knocks to \\"3\\""]\n`, STEPPERS);
		expect(JSON.stringify(twice.featureResults?.[0]?.stepResults)).toContain(`the outcome \\"${OUTCOME}\\" is already registered`);
	});
});
