/**
 * Reasoning over the store: a rule closes over a type that declares its graph complete, refuses to close over an open one,
 * reads an open fact through the read built-in, and sessions that start together run one after the other.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import { individualIri, iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { COMPLETE_GRAPH, REASONER_BUILTIN } from "../domains/reasoning.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { reasoner } from "../root.js";
import { reason } from "./reason.js";

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

/** The facts the store holds: a step with an outcome, a step without one, and a note about the second step. */
const FACTS: [string, string, string, string][] = [
	["s1", "id", "s1", STEP],
	["s1", "outcome", "passed", STEP],
	["s2", "id", "s2", STEP],
	["n1", "id", "n1", NOTE],
	["n1", "content", "checked", NOTE],
	["n1", "about", "s2", NOTE],
];

async function storeWith(): Promise<IQuadStore> {
	const store = getTestWorldWithOptions(DEF_PROTO_OPTIONS).shared.getStore();
	for (const [subject, predicate, object, namedGraph] of FACTS) await store.add({ subject, predicate, object, namedGraph, accessLevel: Access.private });
	return store;
}

describe("reason", () => {
	it("closes over a complete graph with scoped negation", { timeout: 30_000 }, async () => {
		const derived = await reason(reasoner(), await storeWith(), domains, { rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] });
		expect(derived).toEqual([{ subject: step("s2"), predicate: `<${MISSING}>`, object: '"outcome"' }]);
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
