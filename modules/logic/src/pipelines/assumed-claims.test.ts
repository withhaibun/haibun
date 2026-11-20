/**
 * The claims about the records an assumed step wrote: a record consistent with the ontology holds, a record whose type is a
 * subclass of two classes a standard states disjoint is refuted with the axioms, and a record that shares a mailbox with another
 * is that record, with the mailbox in the proof. Dispatch records each claim as an EARL assertion the step made.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, GeneratedAtTimeTextSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations, openWorld } from "@haibun/core/lib/domains/resources.js";
import { EARL_LABEL, EARL_OUTCOME } from "@haibun/core/lib/domains/earl.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import { actionOK } from "@haibun/core/lib/domains/util.js";
import { field } from "@haibun/core/lib/steps/domains/contract.js";
import { AStepper, declareSteps, type IHasCycles, type IStepperCycles } from "@haibun/core/lib/steps/domains/stepper.js";
import { readUpTo, recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import LogicStepper from "../logic-stepper.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { reasoner } from "../root.js";
import { NOTE, PERSON, SHARED_MAILBOX, scopeWith } from "../test/claim-scope.js";
import { assumedClaims, claimProofs, type TAnchorCheck } from "./assumed-claims.js";
import { proofFrames } from "../derivations/proof-frames.js";
import { recordTermsOf } from "../derivations/n3.js";

/** A type a declaration makes both a PROV activity and a PROV entity, which PROV-O states disjoint. */
const HYBRID = "Hybrid";
const hybridType = {
	selectors: ["hybrid"],
	schema: z.object({ id: z.string(), generatedAtTime: GeneratedAtTimeSchema }),
	description: HYBRID,
	topology: { persistedAs: HYBRID, subClassOf: ["prov:Activity", "prov:Entity"], id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
};

/** The check of a record's passages, which these records don't cite, so a claim doesn't call it. */
const UNCALLED_CHECK: TAnchorCheck = () => Promise.reject(new Error("the record doesn't cite a passage, and its passages were checked"));

describe("the claims about the records an assumed step wrote", () => {
	it("holds that a record is consistent with the ontology where its facts don't make it a member of two disjoint classes", { timeout: 60_000 }, async () => {
		const { claims } = await assumedClaims(await scopeWith(reasoner()), [{ label: NOTE, id: "n1" }], UNCALLED_CHECK);
		expect(claims.map(({ test, verdict }) => [test, verdict])).toEqual([[`the ${NOTE} is consistent with the ontology`, VERDICT.proved]]);
	});

	it("refutes a record whose type is a member of two classes a standard states disjoint, with the axioms of the contradiction", { timeout: 60_000 }, async () => {
		const store = storeOfDomains([hybridType]);
		await store.merge({ "@type": HYBRID, id: "h1", accessLevel: Access.private });
		const scope = { reasoner: reasoner(), store, domains: mapDefinitionsToDomains([hybridType]), records: HAIBUN_RECORD_NAMESPACE };
		const {
			claims: [claim],
		} = await assumedClaims(scope, [{ label: HYBRID, id: "h1" }], UNCALLED_CHECK);
		expect(claim?.verdict).toBe(VERDICT.refuted);
		expect(claim?.proof).toContain("DisjointClasses(prov:Activity prov:Entity)");
	});

	it("proves a record the same individual as a record that shares its mailbox, and names the mailbox", { timeout: 60_000 }, async () => {
		const { claims } = await assumedClaims(await scopeWith(reasoner()), [{ label: PERSON, id: "p1" }], UNCALLED_CHECK);
		const identity = claims.find(({ test }) => test === `the ${PERSON} is the ${PERSON} p2`);
		expect(identity?.verdict).toBe(VERDICT.proved);
		expect(identity?.proof).toContain(`DataPropertyAssertion(foaf:mbox Person:p2 "${SHARED_MAILBOX}")`);
	});

	it("holds the premises of an identity's proof as its check, which a why view proves again and frames with the mailbox as a fact of each Person", {
		timeout: 60_000,
	}, async () => {
		const scope = await scopeWith(reasoner());
		const { checks } = await assumedClaims(scope, [{ label: PERSON, id: "p1" }], UNCALLED_CHECK);
		expect(checks.join("\n"), "the check holds the mailbox its proof read").toContain(SHARED_MAILBOX);
		const proofs = await claimProofs(scope, checks.join("\n"));
		const frames = proofFrames(proofs, { persistedAs: "SeqPath", id: "the-step" }, recordTermsOf(scope.domains, scope.records));
		expect(
			frames.assumptions.map(({ fact }) => fact),
			"each Person's mailbox is an assumption a passage can quote",
		).toEqual(
			expect.arrayContaining([
				{ of: { persistedAs: PERSON, id: "p1" }, value: SHARED_MAILBOX },
				{ of: { persistedAs: PERSON, id: "p2" }, value: SHARED_MAILBOX },
			]),
		);
	});
});

/** A widget whose every record has a name, which the store doesn't require. */
const WIDGET = {
	...openWorld(z.object({ id: z.string(), generatedAtTime: GeneratedAtTimeTextSchema, name: z.string(), colour: z.string().optional() }), ["name"]),
	topology: {
		persistedAs: "Widget",
		accessLevel: Access.private,
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, name: LinkRelations.NAME.rel, colour: LinkRelations.TAG.rel },
	},
};

/** Reads a widget from outside input, so its products are assumed, and writes it without the name every widget has. */
class ReadsWidgets extends AStepper implements IHasCycles {
	description = "Reads a widget from outside input into a Widget record.";
	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [{ selectors: ["assumed-widget"], ...WIDGET, topology: { ...WIDGET.topology, required: WIDGET.required }, description: "A widget" }] }),
	};
	steps = declareSteps({
		read: {
			description: TEST_STEP,
			gwta: "read a widget",
			contract: { assumed: true, changes: [field(WIDGET, "colour")] },
			action: async () => {
				await this.getWorld().shared.getStore().merge({ "@type": "Widget", id: "w-1", colour: "red" });
				return actionOK();
			},
		},
	});
}

describe("the EARL assertions of an assumed step's claims", () => {
	it("records each claim about a record the step wrote as an assertion the step made, by the record's typed CURIE", { timeout: 60_000 }, async () => {
		const result = await passWithDefaults("read a widget\n", [ReadsWidgets, LogicStepper]);
		const claims = result.featureResults?.[0]?.stepResults.at(-1)?.contract?.assumed;
		expect(claims?.map(({ test, verdict }) => [test, verdict])).toEqual([
			["the Widget has its name", VERDICT.unknown],
			["the Widget is consistent with the ontology", VERDICT.proved],
		]);
		const store = result.world.shared.getStore();
		const results = await readUpTo(store, { label: EARL_LABEL.testResult }, MAX_PAGE_ROWS);
		expect(results.map(({ outcome }) => outcome).sort(), "each claim's verdict is its EARL outcome").toEqual([EARL_OUTCOME.cantTell, EARL_OUTCOME.passed]);
		expect(await recordOf(store, EARL_LABEL.testSubject, "Widget:w-1"), "the subject is the record by its typed CURIE").toBeDefined();
	});
});
