/**
 * Reasoning over the store: a rule closes over a type that declares its graph complete, refuses to close over an open one,
 * reads an open fact through the read built-in, and sessions that start together run one after the other.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, LinkRelations, type AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { runReadingAt } from "@haibun/core/lib/domains/capability-context.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import { individualIri, iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { COMPLETE_GRAPH, REASONER_BUILTIN, type TProofStep } from "../domains/reasoning.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { reasoner } from "../root.js";
import { explain, reason } from "./reason.js";

const [STEP, NOTE] = ["Step", "Note"];
const typeOf = (persistedAs: string, complete: boolean) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), outcome: z.string().optional(), content: z.string().optional(), about: z.string().optional(), generatedAtTime: z.string() }),
	description: persistedAs,
	topology: {
		persistedAs,
		id: "id",
		accessLevel: Access.private,
		...(complete ? { complete } : {}),
		properties: { id: LinkRelations.IDENTIFIER.rel, outcome: LinkRelations.OUTCOME.rel, content: LinkRelations.CONTENT.rel },
		edges: { about: { rel: LinkRelations.PART_OF.rel, range: STEP } },
	},
});
const domains = mapDefinitionsToDomains([typeOf(STEP, true), typeOf(NOTE, false)]);
const context = getJsonLdContext(domains)["@context"];
const iri = (term: string): string => iriIn(context, term);
const [stepClass, outcome, content, about] = [iri(STEP), iri(LinkRelations.OUTCOME.uri), iri(LinkRelations.CONTENT.uri), iri(LinkRelations.PART_OF.uri)];
const step = (id: string) => `<${individualIri(stepClass, id)}>`;
const LOG = "http://www.w3.org/2000/10/swap/log#";
const MISSING = "urn:test:missing";
const QUERY = `{ ?s <${MISSING}> ?o } => { ?s <${MISSING}> ?o } .`;
/** A step in the complete graph that doesn't state an outcome. */
const WITHOUT_OUTCOME = `{ <${stepClass}> <${COMPLETE_GRAPH}> ?g . ?g <${LOG}includes> { ?s a <${stepClass}> } . ?g <${LOG}notIncludes> { ?s <${outcome}> ?o } } => { ?s <${MISSING}> "outcome" } .`;

/** The facts the store holds, each at its level: a step with an outcome, a step without one, a step whose outcome only a
 *  private reader reads, and a note about the second step. */
const FACTS: [string, string, string, string, AccessLevel][] = [
	["s1", "id", "s1", STEP, Access.private],
	["s1", "outcome", "passed", STEP, Access.private],
	["s2", "id", "s2", STEP, Access.private],
	["s3", "id", "s3", STEP, Access.public],
	["s3", "outcome", "passed", STEP, Access.private],
	["n1", "id", "n1", NOTE, Access.private],
	["n1", "content", "checked", NOTE, Access.private],
	["n1", "about", "s2", NOTE, Access.private],
];

async function storeWith(): Promise<IQuadStore> {
	const store = getTestWorldWithOptions(DEF_PROTO_OPTIONS).shared.getStore();
	for (const [subject, predicate, object, namedGraph, accessLevel] of FACTS) await store.add({ subject, predicate, object, namedGraph, accessLevel });
	return store;
}

describe("reason", () => {
	it("closes over a complete graph with scoped negation", { timeout: 30_000 }, async () => {
		const derived = await reason(reasoner(), await storeWith(), domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] });
		expect(derived).toEqual([{ subject: step("s2"), predicate: `<${MISSING}>`, object: '"outcome"' }]);
	});

	it("closes over a complete graph for a reader at its type's access level, and leaves it open for a reader below it", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		const closed = (level: AccessLevel) => runReadingAt(level, () => reason(reasoner(), store, domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] }));
		expect(await closed(Access.private)).toEqual([{ subject: step("s2"), predicate: `<${MISSING}>`, object: '"outcome"' }]);
		expect(await closed(Access.public), "s3's outcome is private, so a public reader reads the graph as open and the rules don't derive a missing outcome").toEqual([]);
	});

	it("explains a proved claim by its inference chain, down to the complete graph and the rule it rests on", { timeout: 30_000 }, async () => {
		const { proof, open } = await explain(reasoner(), await storeWith(), domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] });
		const missing = { subject: step("s2"), predicate: `<${MISSING}>`, object: '"outcome"' };
		expect(proof.gives).toEqual([missing]);
		expect(open).toEqual([]);
		const byName = new Map(proof.steps.map((held) => [held.step, held]));
		const leaves = (name: string): TProofStep[] => {
			const held = byName.get(name);
			if (held === undefined) throw new Error(`the proof names ${name} without stating it`);
			return held.kind === "extraction" ? [held] : [...held.evidence, ...(held.rule === undefined ? [] : [held.rule])].flatMap(leaves);
		};
		const proved = proof.steps.find(({ kind }) => kind === "proof");
		const rested = leaves(proved?.step ?? "").map(({ gives, source }) => ({ source, graphs: gives.map(({ subject, predicate }) => `${subject} ${predicate}`) }));
		expect(rested, "the proof rests on the complete graph's formula, the rule and the query, each read from its source").toEqual([
			{ source: "<file:///sources.n3>", graphs: [`<${stepClass}> <${COMPLETE_GRAPH}>`] },
			{ source: "<file:///sources.n3>", graphs: [] },
			{ source: "<file:///query.n3>", graphs: [] },
		]);
	});

	it("explains an unknown claim by the graph that stayed open to the reader, and its type's access level", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		const explained = await runReadingAt(Access.public, () => explain(reasoner(), store, domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] }));
		expect(explained).toEqual({ proof: { gives: [], steps: [] }, open: [{ graph: STEP, accessLevel: Access.private }] });
	});

	it("refuses to close over an open graph", async () => {
		await expect(reason(reasoner(), await storeWith(), domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [NOTE] })).rejects.toThrow(
			/Note, whose type doesn't declare its graph complete/,
		);
	});

	it("reads an open fact through the read built-in, with an edge's value as the record it reaches", { timeout: 30_000 }, async () => {
		const note = `<${individualIri(iriIn(context, NOTE), "n1")}>`;
		const rules = `{ (${note} <${about}>) <${REASONER_BUILTIN.read}> ?s . (${note} <${content}>) <${REASONER_BUILTIN.read}> ?c } => { ?s <${MISSING}> ?c } .`;
		const derived = await reason(reasoner(), await storeWith(), domains, { rules, query: QUERY, closedOver: [] });
		expect(derived).toEqual([{ subject: step("s2"), predicate: `<${MISSING}>`, object: '"checked"' }]);
	});

	it("runs sessions that start together one after the other", { timeout: 30_000 }, async () => {
		const [held, store] = [reasoner(), await storeWith()];
		const both = await Promise.all([STEP, STEP].map(() => reason(held, store, domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] })));
		expect(both[0]).toEqual(both[1]);
	});
});
