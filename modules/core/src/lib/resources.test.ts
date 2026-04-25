import { describe, it, expect } from "vitest";
import { LinkRelations, REL_CONTEXT, EdgePredicates, edgeRel, getRelRange, DISCOURSE, DiscourseSchema, CommentSchema, commentDomainDefinition, COMMENT_LABEL } from "./resources.js";
import { RelSchema, getJsonLdContext, buildConcernCatalog } from "./hypermedia.js";

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
		expect(getRelRange(LinkRelations.IN_REPLY_TO.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.WAS_INFORMED_BY.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.MADE_BY_SENSOR.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.PHENOMENON_TIME.rel)).toBe("literal");
		expect(getRelRange(LinkRelations.DISCOURSE.rel)).toBe("literal");
		expect(getRelRange(LinkRelations.CONTEXT.rel)).toBe("container");
		expect(getRelRange(LinkRelations.HAS_RESULT.rel)).toBe("container");
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

describe("Discourse", () => {
	it("accepts every value in the closed enum", () => {
		for (const v of Object.values(DISCOURSE)) {
			expect(() => DiscourseSchema.parse(v)).not.toThrow();
		}
	});

	it("rejects values outside the enum", () => {
		expect(() => DiscourseSchema.parse("unknown")).toThrow();
		expect(() => DiscourseSchema.parse("")).toThrow();
		expect(() => DiscourseSchema.parse(null)).toThrow();
	});

	it("includes observation and change-cycle speech acts", () => {
		expect(DISCOURSE.suggest).toBe("suggest");
		expect(DISCOURSE.measure).toBe("measure");
		expect(DISCOURSE.apply).toBe("apply");
		expect(DISCOURSE.revert).toBe("revert");
	});

	it("includes human-response speech acts", () => {
		expect(DISCOURSE.question).toBe("question");
		expect(DISCOURSE.narrate).toBe("narrate");
		expect(DISCOURSE.report).toBe("report");
	});

	it("includes play (rehearsal / try-out)", () => {
		expect(DISCOURSE.play).toBe("play");
	});

	it("DISCOURSE keys match their values (canonical shape)", () => {
		for (const [key, value] of Object.entries(DISCOURSE)) {
			expect(key).toBe(value);
		}
	});
});

describe("CommentSchema", () => {
	const baseComment = {
		id: "c1",
		text: "hello",
		timestamp: new Date().toISOString(),
	};

	it("accepts a minimal valid Comment with discourse", () => {
		const c = { ...baseComment, discourse: DISCOURSE.narrate };
		expect(() => CommentSchema.parse(c)).not.toThrow();
	});

	it("rejects a Comment missing discourse", () => {
		expect(() => CommentSchema.parse(baseComment)).toThrow();
	});

	it("rejects a Comment with a discourse outside the enum", () => {
		expect(() => CommentSchema.parse({ ...baseComment, discourse: "unknown" })).toThrow();
	});

	it("accepts each discourse enum value", () => {
		for (const d of Object.values(DISCOURSE)) {
			expect(() => CommentSchema.parse({ ...baseComment, discourse: d })).not.toThrow();
		}
	});

	it("accepts an optional author", () => {
		const withAuthor = { ...baseComment, discourse: DISCOURSE.suggest, author: "stepper:llm" };
		const parsed = CommentSchema.parse(withAuthor);
		expect(parsed.author).toBe("stepper:llm");
	});

	it("accepts absence of author (legacy-compatible)", () => {
		const parsed = CommentSchema.parse({ ...baseComment, discourse: DISCOURSE.narrate });
		expect(parsed.author).toBeUndefined();
	});
});

describe("commentDomainDefinition", () => {
	it("has the expected topology shape", () => {
		const t = commentDomainDefinition.topology;
		if (!t) throw new Error("commentDomainDefinition must declare topology");
		expect(t.vertexLabel).toBe(COMMENT_LABEL);
		expect(t.id).toBe("id");
		// discourse is wired through LinkRelations, not a bare string
		expect(t.properties.discourse).toBe(LinkRelations.DISCOURSE.rel);
		expect(t.properties.author).toBe(LinkRelations.ATTRIBUTED_TO.rel);
	});

	it("passes buildConcernCatalog validation", () => {
		// Simulate a registered-domains map as if registerDomains ran.
		const registered = { comment: { ...commentDomainDefinition, coerce: (x: unknown) => x as unknown as import("./resources.js").TDomainDefinition["schema"] } };
		const cat = buildConcernCatalog(registered as Parameters<typeof buildConcernCatalog>[0]);
		expect(cat.vertices[COMMENT_LABEL]).toBeDefined();
		expect(cat.vertices[COMMENT_LABEL].properties.discourse).toBeDefined();
		expect(cat.vertices[COMMENT_LABEL].properties.discourse.rel).toBe(LinkRelations.DISCOURSE.rel);
	});
});
