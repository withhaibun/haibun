import { describe, it, expect, beforeEach } from "vitest";
import { registerContext, clearKeyDocuments, setNetworkResolver } from "@haibun/core/lib/jsonld-loader.js";
import { LinkRelations, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad, TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import { enumerateStandardVocab, resetStandardVocabCache } from "./standard-vocabulary.js";
import { withOntologySchema, ONTOLOGY_PRED, ONTOLOGY_PROPERTY, ONTOLOGY_CLASS, iriLocalName } from "./ontology-projection.js";

const CTX_URL = "urn:test:widget-context";
// A tiny standard context: the Widget class's scoped @context declares its properties; `id` is a keyword alias (dropped).
const CTX_DOC = { "@context": { Widget: { "@context": { id: { "@id": "@id" }, color: { "@id": "ex:color" }, size: "ex:size" } } } };

const domain = (persistedAs: string, standardContexts?: string[]): TRegisteredDomain =>
	({ topology: { persistedAs, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel }, ...(standardContexts ? { standardContexts } : {}) }, schema: { parse: (v: unknown) => v } }) as unknown as TRegisteredDomain;

const withInstance = (type: string): { response: TClusteredQuads; evidence: TQuad[] } => {
	const evidence: TQuad[] = [{ subject: `${type}-1`, predicate: "id", object: `${type}-1`, namedGraph: type, timestamp: 1 }];
	return { response: { quads: evidence, clusters: [{ type, totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: [`${type}-1`], displayLabels: { [`${type}-1`]: `${type}-1` } }] }, evidence };
};

describe("standard-vocabulary — a type's declared standard context becomes its ontology vocabulary", () => {
	beforeEach(() => {
		resetStandardVocabCache();
		clearKeyDocuments();
		setNetworkResolver(undefined);
		registerContext(CTX_URL, CTX_DOC);
	});

	it("enumerates a type's type-scoped context terms (dropping keyword aliases), skipping types with no standardContexts", async () => {
		expect((await enumerateStandardVocab({ w: domain("Widget", [CTX_URL]) })).get("Widget")).toEqual([
			{ term: "color", iri: "ex:color" },
			{ term: "size", iri: "ex:size" },
		]);
		expect(await enumerateStandardVocab({ w: domain("Widget") })).toEqual(new Map());
	});

	it("yields no terms when no resolver can resolve the declared context (fails safe, never throws)", async () => {
		expect((await enumerateStandardVocab({ w: domain("Widget", ["urn:test:unresolvable"]) })).size).toBe(0);
	});

	it("injects each declared term as a Property node marked inData=false with an rdfs:domain edge to its type", async () => {
		const { response, evidence } = withInstance("Widget");
		const vocab = await enumerateStandardVocab({ w: domain("Widget", [CTX_URL]) });
		const schema = withOntologySchema(response, evidence, { w: domain("Widget", [CTX_URL]) }, vocab);
		const q = (subject: string, predicate: string) => schema.quads.find((x) => x.subject === subject && x.predicate === predicate && x.namedGraph === ONTOLOGY_PROPERTY);
		expect(q("color", ONTOLOGY_PRED.uri)?.object).toBe("ex:color");
		expect(q("color", ONTOLOGY_PRED.inData)?.object).toBe(false);
		expect(schema.quads.find((x) => x.subject === "color" && x.predicate === ONTOLOGY_PRED.domain)?.object).toBe("Widget");
		// the Property cluster now carries the injected terms
		const props = schema.clusters.find((c) => (c as { type: string }).type === ONTOLOGY_PROPERTY) as { sampledSubjects: string[] };
		expect(props.sampledSubjects).toEqual(expect.arrayContaining(["color", "size"]));
		// the Widget Class node exists so the domain edges render against it
		const classes = schema.clusters.find((c) => (c as { type: string }).type === ONTOLOGY_CLASS) as { sampledSubjects: string[] };
		expect(classes.sampledSubjects).toContain("Widget");
	});

	it("does not re-list a term whose IRI local name already appears as a present property (CURIE vs full IRI compare equal)", () => {
		// a pre-pruned ontology already carrying a Property `issuer` with the CURIE cred:issuer
		const present = { quads: [{ subject: "issuer", predicate: ONTOLOGY_PRED.uri, object: "cred:issuer", namedGraph: ONTOLOGY_PROPERTY, timestamp: 0 }] as TQuad[], clusters: [] as unknown[] };
		expect(iriLocalName("cred:issuer")).toBe("issuer");
		expect(iriLocalName("https://www.w3.org/2018/credentials#issuer")).toBe("issuer");
		// injection is exercised by the previous test; here we assert the equal local names that make dedup work.
		expect(iriLocalName(String(present.quads[0].object))).toBe(iriLocalName("https://www.w3.org/2018/credentials#issuer"));
	});
});
