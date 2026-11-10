/**
 * A call's check against statements of its step's contract, over the one rule set the relations of every contract generate. A
 * statement holds where the call's facts derive its triple, a negated statement where they don't, and the check states EYE's
 * proof where a statement isn't proved.
 */
import { describe, expect, it } from "vitest";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { doesntHold, holds, parameter, PRINCIPAL, PRODUCTS, type TRelation, type TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { logicEngine, reasoner } from "../root.js";
import { contractChecks } from "./contract-checks.js";

const RULES = "@prefix h: <https://withhaibun.github.io/ns/> .";
/** Two records that allow one action. */
const SHARES: TRelation = {
	name: "shares_action",
	arity: 2,
	rules: `${RULES}\n{ ?a h:allowedAction ?x . ?b h:allowedAction ?x } => { (?a ?b) <urn:haibun:relation:shares_action> true } .`,
};
/** A record that states when it was revoked. */
const REVOKED: TRelation = { name: "revoked_record", arity: 1, rules: `${RULES}\n{ ?c h:revoked ?at } => { (?c) <urn:haibun:relation:revoked_record> true } .` };
/** A record its principal controls. */
const CONTROLS: TRelation = { name: "controls_record", arity: 2, rules: `${RULES}\n{ ?c h:controller ?p } => { (?p ?c) <urn:haibun:relation:controls_record> true } .` };

const PARENT = { id: "urn:cap:parent", allowedAction: "read", controller: "did:key:zHolder" };
const call = (parent: Record<string, unknown>, products?: Record<string, unknown>) => ({
	parameters: { parent },
	principal: "did:key:zHolder",
	...(products === undefined ? {} : { products }),
});

/** The field a negation of REVOKED reads, which a contract states complete. */
const REVOKED_FIELD = { persistedAs: "Record", key: "revoked" };

describe("a call's check against its contract's statements", () => {
	const world = getDefaultWorld();
	const checking = logicEngine().then((engine) => contractChecks([SHARES, REVOKED, CONTROLS], reasoner(), engine));
	const checks = checking.then((check) => (statements: readonly TStatement[], call: Parameters<typeof check>[2]) => check(world, { statements, complete: [REVOKED_FIELD] }, call));

	it("proves a statement the call's facts derive and a negation they don't, without a proof", { timeout: 60_000 }, async () => {
		const check = await checks;
		const checked = await check(
			[holds(SHARES, parameter("parent"), PRODUCTS), doesntHold(REVOKED, parameter("parent")), holds(CONTROLS, PRINCIPAL, parameter("parent"))],
			call(PARENT, { id: "urn:cap:child", allowedAction: "read" }),
		);
		expect(checked.verdicts.map(({ verdict }) => verdict)).toEqual([VERDICT.proved, VERDICT.proved, VERDICT.proved]);
		expect(checked.verdicts[0]?.decidedBy).toBe("the call's facts derive ( <urn:cap:parent> <urn:cap:child> ) <urn:haibun:relation:shares_action> true .");
		expect(checked.proof).toBeUndefined();
	});

	it("refutes a negation the call's facts derive, and states EYE's proof of the derivation", { timeout: 60_000 }, async () => {
		const checked = await (await checks)([doesntHold(REVOKED, parameter("parent"))], call({ ...PARENT, revoked: "2026-11-01T00:00:00Z" }));
		expect(checked.verdicts.map(({ verdict, decidedBy }) => [verdict, decidedBy])).toEqual([
			[VERDICT.refuted, "the call's facts derive ( <urn:cap:parent> ) <urn:haibun:relation:revoked_record> true ."],
		]);
		expect(checked.proof).toContain("revoked_record");
	});

	it("reads a statement the call's facts don't derive as unknown, since the open world doesn't read it as false", { timeout: 60_000 }, async () => {
		const checked = await (await checks)([holds(SHARES, parameter("parent"), PRODUCTS)], call(PARENT, { id: "urn:cap:child", allowedAction: "write" }));
		expect(checked.verdicts.map(({ verdict }) => verdict)).toEqual([VERDICT.unknown]);
		expect(checked.proof).toBeDefined();
	});

	it("reads a negation over a field the contract doesn't state complete as unknown, since its scope is open", { timeout: 60_000 }, async () => {
		const checked = await (await checking)(world, { statements: [doesntHold(REVOKED, parameter("parent"))], complete: [] }, call(PARENT));
		expect(checked.verdicts.map(({ verdict, decidedBy }) => [verdict, decidedBy])).toEqual([
			[
				VERDICT.unknown,
				"the call's facts don't derive ( <urn:cap:parent> ) <urn:haibun:relation:revoked_record> true ., and the contract doesn't state https://withhaibun.github.io/ns/revoked complete",
			],
		]);
	});

	it("refuses a statement that names a value the call doesn't state", { timeout: 60_000 }, async () => {
		await expect((await checks)([holds(SHARES, parameter("parent"), PRODUCTS)], call(PARENT))).rejects.toThrow(
			"names the products, which a call holds once its action returned them",
		);
	});
});
