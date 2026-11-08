/**
 * Dispatch checks a call against its step's contract: its `requires` before the action runs, and its `states` over the products.
 * A statement that isn't proved refuses the call: the action doesn't run where `requires` refuses it, the products aren't kept
 * where `states` refuses them, since the step fails, the step's record holds the check's proof, and the refusal names the statement, its verdict and
 * the triple that determined it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, holds, parameter, PRODUCTS, type TRelation } from "@haibun/core/lib/steps/domains/contract.js";
import { DEF_PROTO_OPTIONS, failWithDefaults } from "@haibun/core/lib/test/lib.js";
import { actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { CONTINUE_AFTER_ERROR, RECORDED_STATUS, VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import LogicStepper from "../logic-stepper.js";

const RULES = "@prefix h: <https://withhaibun.github.io/ns/> .";
const REVOKED: TRelation = { name: "revoked_grant", arity: 1, rules: `${RULES}\n{ ?g h:revoked ?at } => { (?g) <urn:haibun:relation:revoked_grant> true } .` };
const ALLOWS: TRelation = { name: "allows_action", arity: 2, rules: `${RULES}\n{ ?g h:allowedAction ?a } => { (?g ?a) <urn:haibun:relation:allows_action> true } .` };

/** The grants a line names, by name. */
const GRANTS: Record<string, Record<string, string>> = {
	held: { id: "urn:grant:held", allowedAction: "read" },
	revoked: { id: "urn:grant:revoked", allowedAction: "read", revoked: "2026-11-01T00:00:00Z" },
};
const GrantSchema = z.object({ id: z.string(), allowedAction: z.string(), revoked: z.string().optional() });
const GRANT_DOMAIN = "contract-grant";
const DELEGATION_DOMAIN = "contract-delegation";
const ACTIONS = ["read", "write"];
const ACTION_DOMAIN = "contract-action";

/** Delegates a grant: a delegation from a grant that isn't revoked, which allows the action the line names. */
class Delegating extends AStepper implements IHasCycles {
	description = "Delegates from a grant under a contract that requires the grant isn't revoked and states the delegation allows the action.";
	ran: string[] = [];
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [GRANT_DOMAIN], schema: GrantSchema, description: "A grant a line names", written: true, coerce: (proto) => GrantSchema.parse(GRANTS[String(proto.value)]) },
				{ selectors: [DELEGATION_DOMAIN], schema: GrantSchema, description: "A delegation from a grant" },
				{ selectors: [ACTION_DOMAIN], schema: z.enum(ACTIONS), values: ACTIONS, description: "An action a delegation allows" },
			],
			relations: [REVOKED, ALLOWS],
		}),
	};
	steps = {
		delegate: {
			description: TEST_STEP,
			gwta: `delegate {action: ${ACTION_DOMAIN}} from {grant: ${GRANT_DOMAIN}}`,
			contract: { products: DELEGATION_DOMAIN, requires: [doesntHold(REVOKED, parameter("grant"))], states: [holds(ALLOWS, PRODUCTS, parameter("action"))] },
			action: ({ action, grant }: { action: string; grant: z.infer<typeof GrantSchema> }) => {
				this.ran.push(action);
				return Promise.resolve(actionOKWithProducts({ id: `urn:delegation:${action}`, allowedAction: grant.allowedAction }));
			},
		},
	} as const satisfies TStepperSteps;
}

describe("dispatch's check of a call against its step's contract", () => {
	it("runs a call whose contract holds, refuses one whose `requires` doesn't before its action and one whose `states` doesn't over its products", {
		timeout: 120_000,
	}, async () => {
		const lines = ["delegate read from held", "delegate read from revoked", "delegate write from held"];
		const options = { ...DEF_PROTO_OPTIONS, options: { ...DEF_PROTO_OPTIONS.options, [CONTINUE_AFTER_ERROR]: true } };
		const { world } = await failWithDefaults(
			lines.map((content, n) => ({ path: `/features/f${n}`, content })),
			[Haibun, Delegating, LogicStepper],
			options,
		);
		const steps = await readEvery(world.shared.getStore(), { label: SEQ_PATH_LABEL });
		const record = (line: string) => steps.find((step) => step[SEQ_PATH_FIELD.stepText] === line);
		expect(record("delegate read from held")?.[SEQ_PATH_FIELD.error]).toBeUndefined();
		expect(record("delegate read from held")?.[SEQ_PATH_FIELD.actionStatus]).toBe(RECORDED_STATUS.completed);
		const required = record("delegate read from revoked");
		expect(required?.[SEQ_PATH_FIELD.error]).toContain("The call is refused before its action runs: its contract requires ¬revoked_grant({grant}), which is refuted");
		expect(required?.[SEQ_PATH_FIELD.verdict]).toBe(VERDICT.refuted);
		expect(String(required?.[SEQ_PATH_FIELD.proof])).toContain("revoked_grant");
		const stated = record("delegate write from held");
		expect(stated?.[SEQ_PATH_FIELD.error]).toContain("The call's products are refused and aren't kept: its contract states allows_action(products, {action}), which is unknown");
		expect(stated?.[SEQ_PATH_FIELD.actionStatus], "the step whose products are refused fails").toBe(RECORDED_STATUS.failed);
		expect(stated?.[SEQ_PATH_FIELD.proof]).toBeDefined();
		const delegating = world.runtime.steppers?.find((stepper) => stepper instanceof Delegating);
		expect((delegating as Delegating).ran, "the refused call's action doesn't run").toEqual(["read", "write"]);
	});
});
