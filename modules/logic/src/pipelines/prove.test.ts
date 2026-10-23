/**
 * A proof that stops on an exception fails its line with the line and the cause, ends each record it opened, and leaves the
 * features after it to run. The engine below yields until's wait for the line that applies a waypoint once the line's node
 * opens, as an engine that reads the line as until yields it: the record of AGENTS.md's scoping example, which once ended
 * actuality with a duration it couldn't read. The step program and the prover then come from different builds.
 */
import { describe, expect, it } from "vitest";
import { DEF_PROTO_OPTIONS, failWithDefaults } from "@haibun/core/lib/test/lib.js";
import TestSteps from "@haibun/core/lib/test/TestSteps.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import { AStepper, type IHasCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { CONTINUE_AFTER_ERROR, RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { DIFFERENT_BUILDS, EFFECT } from "../domains/logic.js";
import { atom } from "../derivations/terms.js";
import type { TLogicEngine } from "../ports.js";
import { logicEngine } from "../root.js";
import { proverOf } from "./prove.js";

const HEAD = "Variable changed by waypoint";
const SCOPING = `set v to 1\nActivity: Demonstrate scoping\nset v to 2\nwaypoint ${HEAD}\n${HEAD}\nvariable v is 2`;

/** The engine of the process, which yields until's wait at the line's position once a line that applies the waypoint `head`
 *  opens its node. */
function waitingAt(engine: TLogicEngine, head: string): TLogicEngine {
	const applying = new Set<string>();
	return {
		...engine,
		prove: (top, term) => {
			if (term.startsWith(`apply(`) && term.includes(atom(head))) applying.add(top);
			return engine.prove(top, term);
		},
		resume: (top, outcome) => {
			if (!applying.delete(top)) return engine.resume(top, outcome);
			return { need: EFFECT.wait, path: [], request: { node: "n1", attempt: 1 } };
		},
	};
}

/** Proves each feature's lines through the engine that yields a wait for the waypoint's line. */
class WaitingEngine extends AStepper implements IHasCycles {
	description = "Proves through an engine that yields until's wait for the line that applies a waypoint";
	cycles = {
		startFeature: async () => {
			this.getWorld().runtime.prover = proverOf(waitingAt(await logicEngine(), HEAD));
		},
	};
	steps = {} as const satisfies TStepperSteps;
}

describe("a proof that stops on an exception", () => {
	it("fails its line with the line and the cause, ends the line's record, and the next feature runs", async () => {
		const features = [
			{ path: "/features/scoping", content: SCOPING },
			{ path: "/features/after", content: "passes" },
		];
		const options = { ...DEF_PROTO_OPTIONS, options: { ...DEF_PROTO_OPTIONS.options, [CONTINUE_AFTER_ERROR]: true } };
		const result = await failWithDefaults(features, [Haibun, TestSteps, VariablesStepper, ActivitiesStepper, WaitingEngine], options);
		expect(result.failure?.error.message).toContain(`The proof of \`${HEAD}\` tries again a step that doesn't read as until. ${DIFFERENT_BUILDS}`);
		const ran = result.featureResults?.map(({ ok }) => ok);
		expect(ran, "the features after it run").toEqual([false, true]);
		const steps = await readEvery(result.world.shared.getStore(), { label: SEQ_PATH_LABEL });
		const line = steps.find((step) => step[SEQ_PATH_FIELD.stepText] === HEAD);
		expect(line?.[SEQ_PATH_FIELD.actionStatus], "the line's record ends").toBe(RECORDED_STATUS.failed);
	});
});
