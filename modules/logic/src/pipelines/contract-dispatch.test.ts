/**
 * Dispatch checks a call against its step's contract: its `requires` before the action runs, and its `states` over the products.
 * A statement that isn't proved refuses the call: the action doesn't run where `requires` refuses it, the products aren't kept
 * where `states` refuses them, since the step fails, the step's record holds the check's proof, and the refusal names the statement, its verdict and
 * the triple that determined it. Dispatch writes the products of a call whose contract holds, and doesn't write the products of a refused call. A products write
 * that `keep` names keeps a held record that states the same fields, and refuses one that states others.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, holds, KEEP_VERB, parameter, PRODUCTS, type TRelation } from "@haibun/core/lib/steps/domains/contract.js";
import { DEF_PROTO_OPTIONS, failWithDefaults } from "@haibun/core/lib/test/lib.js";
import { actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { CONTINUE_AFTER_ERROR, RECORDED_STATUS, VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { Access, LinkRelations, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { WRITE_VERB } from "@haibun/core/lib/records/domains/unit.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { readUpTo } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
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
/** The stored type of a delegation, which dispatch writes. */
const DELEGATION_LABEL = "ContractDelegation";
const ACTIONS = ["read", "write"];
const ACTION_DOMAIN = "contract-action";
/** The delegation a kept write names, whichever action it allows. */
const KEPT_ID = "urn:delegation:kept";

/** Delegates a grant: a delegation from a grant that isn't revoked, which allows the action the line names. */
class Delegating extends AStepper implements IHasCycles {
	description = "Delegates from a grant under a contract that requires the grant isn't revoked and states the delegation allows the action.";
	ran: string[] = [];
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [GRANT_DOMAIN], schema: GrantSchema, description: "A grant a line names", written: true, coerce: (proto) => GrantSchema.parse(GRANTS[String(proto.value)]) },
				{
					selectors: [DELEGATION_DOMAIN],
					schema: GrantSchema,
					description: "A delegation from a grant",
					topology: {
						persistedAs: DELEGATION_LABEL,
						accessLevel: Access.private,
						id: "id",
						properties: { id: LinkRelations.IDENTIFIER.rel, allowedAction: LinkRelations.TAG.rel },
					},
				},
				{ selectors: [ACTION_DOMAIN], schema: z.enum(ACTIONS), values: ACTIONS, description: "An action a delegation allows" },
			],
			relations: [REVOKED, ALLOWS],
		}),
	};
	steps = {
		delegate: {
			description: TEST_STEP,
			gwta: `delegate {action: ${ACTION_DOMAIN}} from {grant: ${GRANT_DOMAIN}}`,
			contract: {
				products: DELEGATION_DOMAIN,
				written: WRITE_VERB.create,
				requires: [doesntHold(REVOKED, parameter("grant"))],
				states: [holds(ALLOWS, PRODUCTS, parameter("action"))],
			},
			action: ({ action, grant }: { action: string; grant: z.infer<typeof GrantSchema> }) => {
				this.ran.push(action);
				return Promise.resolve(actionOKWithProducts({ id: `urn:delegation:${action}`, allowedAction: grant.allowedAction }));
			},
		},
		keep: {
			description: TEST_STEP,
			gwta: `keep a delegation allowing {action: ${ACTION_DOMAIN}}`,
			contract: { products: DELEGATION_DOMAIN, written: KEEP_VERB },
			action: ({ action }: { action: string }) => Promise.resolve(actionOKWithProducts({ id: KEPT_ID, allowedAction: action })),
		},
	} as const satisfies TStepperSteps;
}

/** Runs `lines` as features, each after the last fails, and returns their step records and the delegations the store holds. */
async function ran(lines: readonly string[]) {
	const options = { ...DEF_PROTO_OPTIONS, options: { ...DEF_PROTO_OPTIONS.options, [CONTINUE_AFTER_ERROR]: true } };
	const { world } = await failWithDefaults(
		lines.map((content, n) => ({ path: `/features/f${n}`, content })),
		[Haibun, Delegating, LogicStepper],
		options,
	);
	const steps = await readUpTo(world.shared.getStore(), { label: SEQ_PATH_LABEL }, MAX_PAGE_ROWS);
	const written = await readUpTo(world.shared.getStore(), { label: DELEGATION_LABEL }, MAX_PAGE_ROWS);
	return { world, steps, written, record: (line: string) => steps.filter((step) => step[SEQ_PATH_FIELD.stepText] === line) };
}

describe("dispatch's check of a call against its step's contract", () => {
	it("runs a call whose contract holds and writes its products, refuses one whose `requires` doesn't before its action and one whose `states` doesn't over its products, and doesn't write the products of either", {
		timeout: 120_000,
	}, async () => {
		const { world, written, record: records } = await ran(["delegate read from held", "delegate read from revoked", "delegate write from held"]);
		const record = (line: string) => records(line)[0];
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
		expect(
			written.map(({ id }) => id),
			"dispatch writes the delegation whose contract holds, and not the one whose products are refused",
		).toEqual(["urn:delegation:read"]);
	});

	it("keeps a record its products state again, and refuses products that state another value of a field the held record states", { timeout: 120_000 }, async () => {
		const again = "keep a delegation allowing read";
		const other = "keep a delegation allowing write";
		const { written, record } = await ran([again, again, other]);
		expect(
			record(again).map((step) => step[SEQ_PATH_FIELD.actionStatus]),
			"the same record written again is kept",
		).toEqual([RECORDED_STATUS.completed, RECORDED_STATUS.completed]);
		const refused = record(other)[0];
		expect(refused?.[SEQ_PATH_FIELD.actionStatus]).toBe(RECORDED_STATUS.failed);
		expect(refused?.[SEQ_PATH_FIELD.error]).toContain('allowedAction "read"');
		expect(
			written.map(({ id, allowedAction }) => [id, allowedAction]),
			"the held record keeps its fields",
		).toEqual([[KEPT_ID, "read"]]);
	});
});
