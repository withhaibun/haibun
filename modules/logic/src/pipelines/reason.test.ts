/**
 * Reasoning over the store: a rule closes over a type that declares its graph complete, refuses to close over an open one,
 * reads an open fact through the read built-in, and sessions that start together run one after the other.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, fieldIri, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations, type AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { runReadingAt } from "@haibun/core/lib/domains/capability-context.js";
import { heldRecordIri, storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import type { TGraphQuery } from "@haibun/core/lib/steps/domains/quad-types.js";
import { iriIn } from "@haibun/core/lib/records/derivations/owl.js";
import { recordIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import { getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { COMPLETE_GRAPH, REASONER_BUILTIN, REASONING_READ_CEILING, type TProofStep } from "../domains/reasoning.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { Quad, Term } from "@rdfjs/types";
import { reasoner } from "../root.js";
import { explain, reason } from "./reason.js";

const [STEP, NOTE] = ["Step", "Note"];
const typeOf = (persistedAs: string, complete: boolean) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), outcome: z.string().optional(), content: z.string().optional(), about: z.string().optional(), generatedAtTime: GeneratedAtTimeSchema }),
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
const definitions = [typeOf(STEP, true), typeOf(NOTE, false)];
const domains = mapDefinitionsToDomains(definitions);
const context = getJsonLdContext(domains)["@context"];
const iri = (term: string): string => iriIn(context, term);
const [stepClass, outcome, content, about] = [
	iri(STEP),
	iri(fieldIri({ persistedAs: STEP }, "outcome", LinkRelations.OUTCOME.rel, undefined)),
	iri(fieldIri({ persistedAs: NOTE }, "content", LinkRelations.CONTENT.rel, undefined)),
	iri(fieldIri({ persistedAs: NOTE }, "about", LinkRelations.PART_OF.rel, undefined)),
];
const individual = (label: string, id: string) => `<${iriIn(context, recordIri(HAIBUN_RECORD_NAMESPACE.prefix, label, id))}>`;
const step = (id: string) => individual(STEP, id);
/** A derived quad's subject, predicate and object, each by its value. */
const valuesOf = (quads: readonly Quad[]) => quads.map(({ subject, predicate, object }) => [subject.value, predicate.value, object.value]);
const missingOf = (id: string, what: string) => [step(id).slice(1, -1), MISSING, what];
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
	const store = storeOfDomains(definitions);
	for (const [subject, predicate, object, namedGraph, accessLevel] of FACTS) await store.add({ subject, predicate, object, namedGraph, accessLevel });
	return store;
}

describe("reason", () => {
	it("closes over a complete graph with scoped negation", { timeout: 30_000 }, async () => {
		const derived = await reason(reasoner(), await storeWith(), domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] });
		expect(valuesOf(derived)).toEqual([missingOf("s2", "outcome")]);
	});

	it("closes over a complete graph for a reader at its type's access level, and leaves it open for a reader below it", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		const closed = (level: AccessLevel) =>
			runReadingAt(level, () => reason(reasoner(), store, domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] }));
		expect(valuesOf(await closed(Access.private))).toEqual([missingOf("s2", "outcome")]);
		expect(await closed(Access.public), "s3's outcome is private, so a public reader reads the graph as open and the rules don't derive a missing outcome").toEqual([]);
	});

	it("explains a proved claim by its inference chain, down to the complete graph and the rule it rests on", { timeout: 30_000 }, async () => {
		const { proof, open } = await explain(reasoner(), await storeWith(), domains, HAIBUN_RECORD_NAMESPACE, {
			ruleSets: [],
			rules: WITHOUT_OUTCOME,
			query: QUERY,
			closedOver: [STEP],
		});
		expect(valuesOf(proof.gives)).toEqual([missingOf("s2", "outcome")]);
		expect(open).toEqual([]);
		const byName = new Map(proof.steps.map((held) => [held.step.value, held]));
		const leaves = (name: Term): TProofStep[] => {
			const held = byName.get(name.value);
			if (held === undefined) throw new Error(`the proof names ${name.value} without stating it`);
			return held.kind === "extraction" ? [held] : [...held.evidence, ...(held.rule === undefined ? [] : [held.rule])].flatMap(leaves);
		};
		const proved = proof.steps.find(({ kind }) => kind === "proof");
		if (proved === undefined) throw new Error("the explanation doesn't state its proof");
		const rested = leaves(proved.step).map(({ gives, source }) => ({
			source: source?.value,
			graphs: gives.map(({ subject, predicate }) => `${subject.value} ${predicate.value}`),
		}));
		expect(rested, "the proof rests on the complete graph's formula, the rule and the query, each read from its source").toEqual([
			{ source: "file:///sources.n3", graphs: [`${stepClass} ${COMPLETE_GRAPH}`] },
			{ source: "file:///sources.n3", graphs: [] },
			{ source: "file:///query.n3", graphs: [] },
		]);
	});

	it("explains an unknown claim by the graph that stayed open to the reader, and its type's access level", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		const explained = await runReadingAt(Access.public, () =>
			explain(reasoner(), store, domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] }),
		);
		expect(explained).toEqual({ proof: { gives: [], steps: [], text: "" }, open: [{ graph: STEP, accessLevel: Access.private }] });
	});

	it("leaves open a complete graph whose read stopped at the ceiling, and names the ceiling", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		/** A store whose Step records run past the reasoning's ceiling. */
		const many = new Proxy(store, {
			get: (target, property, receiver) =>
				property === "readRecords"
					? (query: TGraphQuery) => {
							if (query.label !== STEP) return target.readRecords(query);
							const { offset, limit } = query;
							if (offset === undefined || limit === undefined) throw new Error("the reasoning reads a type's records in pages");
							const ids = Array.from({ length: Math.max(0, Math.min(limit, REASONING_READ_CEILING + 1 - offset)) }, (_, at) => `s-${offset + at}`);
							return Promise.resolve({ vertices: ids.map((id) => ({ "@id": heldRecordIri(STEP, id), "@type": STEP, id })), total: ids.length, saturated: false, order: [] });
						}
					: Reflect.get(target, property, receiver),
		});
		const explained = await explain(reasoner(), many, domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] });
		expect(explained).toEqual({ proof: { gives: [], steps: [], text: "" }, open: [{ graph: STEP, readCeiling: REASONING_READ_CEILING }] });
	});

	it("refuses to close over an open graph", async () => {
		await expect(
			reason(reasoner(), await storeWith(), domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [NOTE] }),
		).rejects.toThrow(/Note, whose type doesn't declare its graph complete/);
	});

	it("reads an open fact through the read built-in, with an edge's value as the record it reaches", { timeout: 30_000 }, async () => {
		const note = individual(NOTE, "n1");
		const rules = `{ (${note} <${about}>) <${REASONER_BUILTIN.read}> ?s . (${note} <${content}>) <${REASONER_BUILTIN.read}> ?c } => { ?s <${MISSING}> ?c } .`;
		const derived = await reason(reasoner(), await storeWith(), domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules, query: QUERY, closedOver: [] });
		expect(valuesOf(derived)).toEqual([missingOf("s2", "checked")]);
	});

	it("runs sessions that start together one after the other", { timeout: 30_000 }, async () => {
		const [held, store] = [reasoner(), await storeWith()];
		const both = await Promise.all(
			[STEP, STEP].map(() => reason(held, store, domains, HAIBUN_RECORD_NAMESPACE, { ruleSets: [], rules: WITHOUT_OUTCOME, query: QUERY, closedOver: [STEP] })),
		);
		expect(both[0]).toEqual(both[1]);
	});
});
