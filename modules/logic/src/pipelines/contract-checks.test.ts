/**
 * A call's check against statements of its step's contract, over the one rule set the relations of every contract generate. A
 * statement holds where the call's facts derive its triple, a negated statement where they don't, and the check returns the facts
 * it read, over which EYE proves the check where a why requests its proof.
 */
import { describe, expect, it } from "vitest";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { checkN3, CONTRACT_CHECK, doesntHold, field, holds, parameter, PRINCIPAL, PRODUCTS, type TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { CONTROLS_GRANT, GRANT, REVOKED_GRANT, SHARES_ACTION } from "@haibun/core/lib/test/contract-grants.js";
import { declaredFieldIri } from "@haibun/core/lib/domains/hypermedia.js";
import { registerDomains } from "@haibun/core/lib/domains/domains.js";
import { NODE_KEY } from "@haibun/core/lib/records/domains/unit.js";
import { recordTermsOf } from "../derivations/n3.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { logicEngine, reasoner } from "../root.js";
import { contractChecks, contractProofs } from "./contract-checks.js";
import { drawnNames, proofFrames } from "../derivations/proof-frames.js";

/** A grant as a call states it: the node of a stored grant. */
const grant = (fields: Record<string, unknown>) => ({ [NODE_KEY.type]: GRANT.topology.persistedAs, ...fields });
const PARENT = grant({ id: "urn:cap:parent", allowedAction: "read", controller: "did:key:zHolder" });
const call = (parent: Record<string, unknown>, products?: Record<string, unknown>) => ({
	parameters: { parent },
	principal: "did:key:zHolder",
	...(products === undefined ? {} : { products }),
});

/** The field a negation of REVOKED_GRANT reads, which a contract states complete. */
const REVOKED_FIELD = field(GRANT, "revoked");

describe("a call's check against its contract's statements", () => {
	const world = getDefaultWorld();
	registerDomains(world, [[{ selectors: ["test-grant"], ...GRANT, description: "A grant a call states" }]]);
	/** The IRI of the grant `id`, as the check names it. */
	const iri = (id: string): string => `<${recordTermsOf(world.domains, world.runtime.records).individualAt(`${GRANT.topology.persistedAs}:${id}`).value}>`;
	const checking = logicEngine().then((engine) => contractChecks([SHARES_ACTION, REVOKED_GRANT, CONTROLS_GRANT], reasoner(), engine));
	const checks = checking.then((check) => (statements: readonly TStatement[], call: Parameters<typeof check>[2]) => check(world, { statements, complete: [REVOKED_FIELD] }, call));

	it("proves a statement the call's facts derive and a negation they don't, and returns the facts it read", { timeout: 60_000 }, async () => {
		const check = await checks;
		const checked = await check(
			[holds(SHARES_ACTION, parameter("parent"), PRODUCTS), doesntHold(REVOKED_GRANT, parameter("parent")), holds(CONTROLS_GRANT, PRINCIPAL, parameter("parent"))],
			call(PARENT, grant({ id: "urn:cap:child", allowedAction: "read" })),
		);
		expect(checked.verdicts.map(({ verdict }) => verdict)).toEqual([VERDICT.proved, VERDICT.proved, VERDICT.proved]);
		expect(checked.verdicts[0]?.decidedBy).toBe(`the call's facts derive ( ${iri("urn:cap:parent")} ${iri("urn:cap:child")} ) <urn:haibun:relation:shares_action> true .`);
		expect(checked.facts, "the facts state a grant's field by the IRI its type declares").toContain(
			`${iri("urn:cap:parent")} <${declaredFieldIri(GRANT.topology, "allowedAction")}> "read"`,
		);
	});

	it("refutes a negation the call's facts derive, and EYE's proof of the check lists the facts, then the derivation", { timeout: 60_000 }, async () => {
		const checked = await (await checks)([doesntHold(REVOKED_GRANT, parameter("parent"))], call(grant({ ...PARENT, revoked: "2026-11-01T00:00:00Z" })));
		expect(checked.verdicts.map(({ verdict, decidedBy }) => [verdict, decidedBy])).toEqual([
			[VERDICT.refuted, `the call's facts derive ( ${iri("urn:cap:parent")} ) <urn:haibun:relation:revoked_grant> true .`],
		]);
		const proofs = await contractProofs([SHARES_ACTION, REVOKED_GRANT, CONTROLS_GRANT], reasoner(), checkN3(CONTRACT_CHECK.requires, checked.facts));
		const frames = proofFrames(proofs, { persistedAs: "SeqPath", id: "the-step" }, drawnNames(recordTermsOf(world.domains, world.runtime.records)));
		expect(frames.assumptions.map(({ dl }) => dl).join("\n"), "the revocation the check read is an assumption").toContain("2026-11-01T00:00:00Z");
		const revoked = frames.derived.find(({ dl }) => dl === "revoked_grant(urn:cap:parent)");
		expect(revoked?.name.split(" ")[0], "the selected triple is in the conclusion").toBe("conclusion");
		expect(revoked?.nodes, "the conclusion names the record it states, which the graph view highlights").toEqual(["urn:cap:parent"]);
	});

	it("reads a statement the call's facts don't derive as unknown, since the open world doesn't read it as false", { timeout: 60_000 }, async () => {
		const checked = await (await checks)([holds(SHARES_ACTION, parameter("parent"), PRODUCTS)], call(PARENT, grant({ id: "urn:cap:child", allowedAction: "write" })));
		expect(checked.verdicts.map(({ verdict }) => verdict)).toEqual([VERDICT.unknown]);
	});

	it("reads a negation over a field the contract doesn't state complete as unknown, since its scope is open", { timeout: 60_000 }, async () => {
		const checked = await (await checking)(world, { statements: [doesntHold(REVOKED_GRANT, parameter("parent"))], complete: [] }, call(PARENT));
		expect(checked.verdicts.map(({ verdict, decidedBy }) => [verdict, decidedBy])).toEqual([
			[
				VERDICT.unknown,
				`the call's facts don't derive ( ${iri("urn:cap:parent")} ) <urn:haibun:relation:revoked_grant> true ., and the contract doesn't state ${declaredFieldIri(GRANT.topology, "revoked")} complete`,
			],
		]);
	});

	it("refuses a statement that names a value the call doesn't state", { timeout: 60_000 }, async () => {
		await expect((await checks)([holds(SHARES_ACTION, parameter("parent"), PRODUCTS)], call(PARENT))).rejects.toThrow(
			"names the products, which a call holds once its action returned them",
		);
	});
});
