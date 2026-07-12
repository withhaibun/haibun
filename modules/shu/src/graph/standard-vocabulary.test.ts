import { describe, it, expect, beforeEach } from "vitest";
import { registerContext, clearKeyDocuments, setNetworkResolver } from "@haibun/core/lib/jsonld-loader.js";
import { LinkRelations, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad, TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import { enumerateStandardVocab, resetStandardVocabCache } from "./standard-vocabulary.js";
import { withOntologySchema, ONTOLOGY_PRED, ONTOLOGY_PROPERTY, ONTOLOGY_CLASS } from "./ontology-projection.js";

const CTX_URL = "urn:test:widget-context";
// A standard context whose Widget type-scoped @context declares three terms (full IRIs; `id` is a keyword alias → dropped).
const CTX_DOC = { "@context": { Widget: { "@context": { id: { "@id": "@id" }, color: { "@id": "http://example.org/color" }, size: { "@id": "http://example.org/size" } } } } };

// Widget models `id` and `size` as its own fields; it conforms to the context (which also declares `color`).
const domain = (persistedAs: string, standardContexts?: string[]): TRegisteredDomain =>
	({ topology: { persistedAs, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel, size: LinkRelations.TAG.rel }, ...(standardContexts ? { standardContexts } : {}) }, schema: { parse: (v: unknown) => v } }) as unknown as TRegisteredDomain;

const withInstance = (type: string): { response: TClusteredQuads; evidence: TQuad[] } => {
	const evidence: TQuad[] = [{ subject: `${type}-1`, predicate: "id", object: `${type}-1`, namedGraph: type, timestamp: 1 }];
	return { response: { quads: evidence, clusters: [{ type, totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: [`${type}-1`], displayLabels: { [`${type}-1`]: `${type}-1` } }] }, evidence };
};

describe("standard-vocabulary — the type's declared standard context resolved via jsonld, one source", () => {
	beforeEach(() => {
		resetStandardVocabCache();
		clearKeyDocuments();
		setNetworkResolver(undefined);
		registerContext(CTX_URL, CTX_DOC);
	});

	it("returns the standard terms the type does NOT model — deduped by name against the type's own fields", async () => {
		// color is declared by the context but not a Widget field → declared-not-present; size IS a Widget field → excluded.
		expect((await enumerateStandardVocab({ w: domain("Widget", [CTX_URL]) })).get("Widget")).toEqual([{ term: "color", iri: "http://example.org/color" }]);
		expect(await enumerateStandardVocab({ w: domain("Widget") })).toEqual(new Map());
	});

	it("yields no terms when no resolver can resolve the declared context (fails safe, never throws or fabricates)", async () => {
		expect((await enumerateStandardVocab({ w: domain("Widget", ["urn:test:unresolvable"]) })).size).toBe(0);
	});

	it("does not fabricate terms from a non-object (string) type-scoped context — jsonld yields nothing, no character-walk", async () => {
		resetStandardVocabCache();
		registerContext("urn:test:string-scoped", { "@context": { Widget: { "@context": "urn:test:unresolvable-inner" } } });
		expect((await enumerateStandardVocab({ w: domain("Widget", ["urn:test:string-scoped"]) })).size).toBe(0);
	});

	it("injects each declared-not-present term as a Property node marked inData=false with an rdfs:domain edge to its type", async () => {
		const { response, evidence } = withInstance("Widget");
		const vocab = await enumerateStandardVocab({ w: domain("Widget", [CTX_URL]) });
		const schema = withOntologySchema(response, evidence, { w: domain("Widget", [CTX_URL]) }, vocab);
		const q = (subject: string, predicate: string) => schema.quads.find((x) => x.subject === subject && x.predicate === predicate && x.namedGraph === ONTOLOGY_PROPERTY);
		expect(q("color", ONTOLOGY_PRED.uri)?.object).toBe("http://example.org/color");
		expect(q("color", ONTOLOGY_PRED.inData)?.object).toBe(false);
		expect(schema.quads.find((x) => x.subject === "color" && x.predicate === ONTOLOGY_PRED.domain)?.object).toBe("Widget");
		expect(q("size", ONTOLOGY_PRED.inData)).toBeUndefined(); // size is a modeled field, never injected
		const classes = schema.clusters.find((c) => (c as { type: string }).type === ONTOLOGY_CLASS) as { sampledSubjects: string[] };
		expect(classes.sampledSubjects).toContain("Widget");
	});
});
