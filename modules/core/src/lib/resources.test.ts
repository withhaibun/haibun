import { describe, it, expect } from "vitest";
import { LinkRelations, REL_CONTEXT, EdgePredicates, edgeRel, getRelRange } from "./resources.js";
import { RelSchema, getJsonLdContext } from "./hypermedia.js";

describe("LinkRelations extensions", () => {
	const newRels = [
		"wasInformedBy",
		"invalidated",
		"wasAssociatedWith",
		"wasStartedBy",
		"startedAtTime",
		"phenomenonTime",
		"resultTime",
		"hasResult",
		"madeBySensor",
		"observedProperty",
		"schemaObject",
		"schemaResult",
		"replacee",
		"replacement",
		"discourse",
		"seqPath",
		"hostId",
		"accessLevel",
		"measurementKind",
		"shapeDigest",
		"outcomeReason",
	] as const;

	it("each new rel is a valid RelSchema value", () => {
		for (const rel of newRels) {
			expect(() => RelSchema.parse(rel)).not.toThrow();
		}
	});

	it("REL_CONTEXT maps each new rel to its vocabulary URI", () => {
		const expected: Record<string, string> = {
			wasInformedBy: "prov:wasInformedBy",
			invalidated: "prov:invalidated",
			wasAssociatedWith: "prov:wasAssociatedWith",
			wasStartedBy: "prov:wasStartedBy",
			startedAtTime: "prov:startedAtTime",
			phenomenonTime: "sosa:phenomenonTime",
			resultTime: "sosa:resultTime",
			hasResult: "sosa:hasResult",
			madeBySensor: "sosa:madeBySensor",
			observedProperty: "sosa:observedProperty",
			schemaObject: "schema:object",
			schemaResult: "schema:result",
			replacee: "schema:replacee",
			replacement: "schema:replacement",
			discourse: "hbn:discourse",
			seqPath: "hbn:seqPath",
			hostId: "hbn:hostId",
			accessLevel: "hbn:accessLevel",
			measurementKind: "hbn:measurementKind",
			shapeDigest: "hbn:shapeDigest",
			outcomeReason: "hbn:outcomeReason",
		};
		for (const [rel, uri] of Object.entries(expected)) {
			expect(REL_CONTEXT[rel as keyof typeof REL_CONTEXT]).toBe(uri);
		}
	});

	it("relation: true is set on edge-like PROV / SOSA rels", () => {
		expect(LinkRelations.WAS_INFORMED_BY.relation).toBe(true);
		expect(LinkRelations.INVALIDATED.relation).toBe(true);
		expect(LinkRelations.WAS_STARTED_BY.relation).toBe(true);
		expect(LinkRelations.MADE_BY_SENSOR.relation).toBe(true);
	});

	it("relation: false on value-typed predicates", () => {
		expect(LinkRelations.PHENOMENON_TIME.relation).toBe(false);
		expect(LinkRelations.DISCOURSE.relation).toBe(false);
		expect(LinkRelations.SCHEMA_RESULT.relation).toBe(false);
	});

	it("range is declared on every entry", () => {
		for (const entry of Object.values(LinkRelations)) {
			expect(["iri", "literal", "container"]).toContain(entry.range);
		}
	});

	it("relation: true implies range: 'iri'", () => {
		// Conversational / threading links always point at another vertex.
		for (const entry of Object.values(LinkRelations)) {
			if (entry.relation) expect(entry.range).toBe("iri");
		}
	});

	it("getRelRange returns the correct range for each rel", () => {
		expect(getRelRange("inReplyTo")).toBe("iri");
		expect(getRelRange("wasInformedBy")).toBe("iri");
		expect(getRelRange("madeBySensor")).toBe("iri");
		expect(getRelRange("phenomenonTime")).toBe("literal");
		expect(getRelRange("discourse")).toBe("literal");
		expect(getRelRange("context")).toBe("container");
		expect(getRelRange("hasResult")).toBe("container");
	});

	it("getRelRange returns undefined for unknown rels", () => {
		expect(getRelRange("not-a-rel")).toBeUndefined();
	});
});

describe("EdgePredicates additions", () => {
	it("resolves new edge rels via edgeRel()", () => {
		expect(edgeRel("wasInformedBy")).toBe("wasInformedBy");
		expect(edgeRel("invalidated")).toBe("invalidated");
		expect(edgeRel("madeBySensor")).toBe("madeBySensor");
	});

	it("each new EdgePredicate key exists in the exported object", () => {
		expect(EdgePredicates.wasInformedBy).toBeDefined();
		expect(EdgePredicates.invalidated).toBeDefined();
		expect(EdgePredicates.madeBySensor).toBeDefined();
	});
});

describe("getJsonLdContext prefix declarations", () => {
	it("declares all new vocabulary prefixes", () => {
		const out = getJsonLdContext({}) as { "@context": Record<string, unknown> };
		const ctx = out["@context"];
		expect(ctx.prov).toBe("https://www.w3.org/ns/prov#");
		expect(ctx.sosa).toBe("http://www.w3.org/ns/sosa/");
		expect(ctx.schema).toBe("https://schema.org/");
		expect(ctx.otel).toBe("https://opentelemetry.io/schemas/");
		expect(ctx.hbn).toBe("https://haibun.dev/ns/");
	});

	it("preserves pre-existing prefixes unchanged", () => {
		const out = getJsonLdContext({}) as { "@context": Record<string, unknown> };
		const ctx = out["@context"];
		expect(ctx.as).toBe("https://www.w3.org/ns/activitystreams#");
		expect(ctx.foaf).toBe("http://xmlns.com/foaf/0.1/");
		expect(ctx.dcterms).toBe("http://purl.org/dc/terms/");
		expect(ctx.haibun).toBe("/ns/");
	});
});
