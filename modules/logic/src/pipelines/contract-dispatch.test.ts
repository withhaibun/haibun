/**
 * Dispatch checks a call against its step's contract: its `requires` before the action runs, over the records its arguments name,
 * which the check reads from the store, and its `states` over the products.
 * A statement that isn't proved refuses the call: the action doesn't run where `requires` refuses it, the products aren't kept
 * where `states` refuses them, since the step fails, the step's record holds the check's proof, and the refusal names the statement, its verdict and
 * the triple that determined it. Dispatch writes the products of a call whose contract holds, and doesn't write the products of a refused call. A products write
 * that `create` names is refused where the store holds the record, whatever fields it states.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, field, holds, parameter, PRODUCTS, type TRelation } from "@haibun/core/lib/steps/domains/contract.js";
import { refDomainKey } from "@haibun/core/lib/domains/domains.js";
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
/** The stored type of a grant, which a line holds before a delegation names it. */
const GRANT = {
	schema: GrantSchema,
	topology: {
		persistedAs: "ContractGrant",
		accessLevel: Access.private,
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, allowedAction: LinkRelations.TAG.rel, revoked: LinkRelations.REVOKED.rel },
	},
};
const HELD_GRANT_DOMAIN = "contract-held-grant";
const DELEGATION_DOMAIN = "contract-delegation";
/** The stored type of a delegation, which dispatch writes. */
const DELEGATION_LABEL = "ContractDelegation";
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
				{ selectors: [HELD_GRANT_DOMAIN], ...GRANT, description: "A grant the store holds" },
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
		hold: {
			description: TEST_STEP,
			gwta: `hold grant {grant: ${GRANT_DOMAIN}}`,
			contract: { products: HELD_GRANT_DOMAIN, written: WRITE_VERB.create },
			action: ({ grant }: { grant: z.infer<typeof GrantSchema> }) => Promise.resolve(actionOKWithProducts(grant)),
		},
		delegate: {
			description: TEST_STEP,
			gwta: `delegate {action: ${ACTION_DOMAIN}} from {grant: ${refDomainKey(HELD_GRANT_DOMAIN)}}`,
			contract: {
				products: DELEGATION_DOMAIN,
				written: WRITE_VERB.create,
				requires: [doesntHold(REVOKED, parameter("grant"))],
				states: [holds(ALLOWS, PRODUCTS, parameter("action"))],
				complete: [field(GRANT, "revoked")],
			},
			action: ({ action }: { action: string }) => {
				this.ran.push(action);
				return Promise.resolve(actionOKWithProducts({ id: `urn:delegation:${action}`, allowedAction: "read" }));
			},
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
		const [fromHeld, fromRevoked, writeFromHeld] = [
			`delegate read from "${GRANTS.held?.id}"`,
			`delegate read from "${GRANTS.revoked?.id}"`,
			`delegate write from "${GRANTS.held?.id}"`,
		];
		const { world, written, record: records } = await ran([`hold grant held\nhold grant revoked\n${fromHeld}`, fromRevoked, writeFromHeld]);
		const record = (line: string) => records(line)[0];
		expect(record(fromHeld)?.[SEQ_PATH_FIELD.error]).toBeUndefined();
		expect(record(fromHeld)?.[SEQ_PATH_FIELD.actionStatus]).toBe(RECORDED_STATUS.completed);
		const required = record(fromRevoked);
		expect(required?.[SEQ_PATH_FIELD.error], "the check reads the held grant the line names").toContain(
			"The call is refused before its action runs: its contract requires ¬revoked_grant({grant}), which is refuted",
		);
		expect(required?.[SEQ_PATH_FIELD.verdict]).toBe(VERDICT.refuted);
		expect(String(required?.[SEQ_PATH_FIELD.proof]), "EYE's proof cites the held grant's revocation").toContain("2026-11-01T00:00:00Z");
		const stated = record(writeFromHeld);
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

	it("refuses a create of products whose record the store holds, though the products state the same fields", { timeout: 120_000 }, async () => {
		const line = `delegate read from "${GRANTS.held?.id}"`;
		const { written, record } = await ran([`hold grant held\n${line}`, line]);
		const refused = record(line).filter((step) => step[SEQ_PATH_FIELD.actionStatus] === RECORDED_STATUS.failed);
		expect(
			record(line)
				.map((step) => step[SEQ_PATH_FIELD.actionStatus])
				.sort(),
			"the second create of the held record fails",
		).toEqual([RECORDED_STATUS.completed, RECORDED_STATUS.failed].sort());
		expect(refused[0]?.[SEQ_PATH_FIELD.error]).toContain("urn:delegation:read");
		expect(written.map(({ id }) => id)).toEqual(["urn:delegation:read"]);
	});
});
