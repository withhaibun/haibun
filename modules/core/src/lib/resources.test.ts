import { describe, it, expect } from "vitest";
import {
	LinkRelations,
	REL_CONTEXT,
	EdgePredicates,
	edgeRel,
	getRelRange,
	isReplyEdge,
	isSubPropertyOf,
	DISCOURSE_RELS,
	CommentSchema,
	commentDomainDefinition,
	COMMENT_LABEL,
	getPropertyDefinitions,
} from "./resources.js";
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
		"measure",
		"narrate",
		"question",
		"play",
		"petition",
		"grant",
		"deny",
		"invoke",
		"revoke",
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
			measure: "hbn:measure",
			narrate: "hbn:narrate",
			question: "hbn:question",
			play: "hbn:play",
			petition: "hbn:petition",
			grant: "hbn:grant",
			deny: "hbn:deny",
			invoke: "hbn:invoke",
			revoke: "hbn:revoke",
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

	it("isReplyEdge returns true for edge-like PROV / SOSA reply rels", () => {
		expect(isReplyEdge(LinkRelations.WAS_INFORMED_BY.rel)).toBe(true);
		expect(isReplyEdge(LinkRelations.INVALIDATED.rel)).toBe(true);
		expect(isReplyEdge(LinkRelations.WAS_STARTED_BY.rel)).toBe(true);
		expect(isReplyEdge(LinkRelations.MADE_BY_SENSOR.rel)).toBe(true);
	});

	it("isReplyEdge returns true for all discourse rels", () => {
		for (const rel of DISCOURSE_RELS) {
			expect(isReplyEdge(rel)).toBe(true);
		}
	});

	it("isReplyEdge returns false for value-typed predicates", () => {
		expect(isReplyEdge(LinkRelations.PHENOMENON_TIME.rel)).toBe(false);
		expect(isReplyEdge(LinkRelations.SCHEMA_RESULT.rel)).toBe(false);
		expect(isReplyEdge(LinkRelations.ACCESS_LEVEL.rel)).toBe(false);
	});

	it("range is declared on every entry", () => {
		for (const entry of Object.values(LinkRelations)) {
			expect(["iri", "literal", "container"]).toContain(entry.range);
		}
	});

	it("every reply-edge rel has range: 'iri'", () => {
		for (const entry of Object.values(LinkRelations)) {
			if (isReplyEdge(entry.rel)) expect(entry.range).toBe("iri");
		}
	});

	it("getRelRange returns the correct range for each rel", () => {
		expect(getRelRange(LinkRelations.IN_REPLY_TO.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.WAS_INFORMED_BY.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.MADE_BY_SENSOR.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.NARRATE.rel)).toBe("iri");
		expect(getRelRange(LinkRelations.PHENOMENON_TIME.rel)).toBe("literal");
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

describe("Discourse rels", () => {
	it("all discourse rels are sub-properties of inReplyTo", () => {
		for (const rel of DISCOURSE_RELS) {
			expect(isSubPropertyOf(rel, LinkRelations.IN_REPLY_TO.rel)).toBe(true);
		}
	});

	it("each discourse rel has range: 'iri'", () => {
		for (const rel of DISCOURSE_RELS) {
			expect(getRelRange(rel)).toBe("iri");
		}
	});

	it("discourse rels have label and icon declared", () => {
		for (const rel of DISCOURSE_RELS) {
			const entry = Object.values(LinkRelations).find((e) => e.rel === rel);
			expect(entry).toBeDefined();
			expect((entry as { label?: string }).label).toBeTruthy();
			expect((entry as { icon?: string }).icon).toBeTruthy();
		}
	});

	it("DISCOURSE_RELS contains exactly the 9 kept speech acts", () => {
		expect(DISCOURSE_RELS).toContain("measure");
		expect(DISCOURSE_RELS).toContain("narrate");
		expect(DISCOURSE_RELS).toContain("question");
		expect(DISCOURSE_RELS).toContain("play");
		expect(DISCOURSE_RELS).toContain("petition");
		expect(DISCOURSE_RELS).toContain("grant");
		expect(DISCOURSE_RELS).toContain("deny");
		expect(DISCOURSE_RELS).toContain("invoke");
		expect(DISCOURSE_RELS).toContain("revoke");
		expect(DISCOURSE_RELS).not.toContain("suggest");
		expect(DISCOURSE_RELS).not.toContain("report");
		expect(DISCOURSE_RELS).not.toContain("apply");
		expect(DISCOURSE_RELS).not.toContain("revert");
	});
});

describe("CommentSchema", () => {
	const baseComment = {
		id: "c1",
		text: "hello",
		timestamp: new Date().toISOString(),
	};

	it("accepts a minimal valid Comment without discourse property", () => {
		expect(() => CommentSchema.parse({ id: "c1", timestamp: new Date().toISOString() })).not.toThrow();
	});

	it("accepts an optional author", () => {
		const withAuthor = { ...baseComment, author: "stepper:llm" };
		const parsed = CommentSchema.parse(withAuthor);
		expect(parsed.author).toBe("stepper:llm");
	});

	it("accepts absence of author", () => {
		const parsed = CommentSchema.parse({ id: "c1", timestamp: new Date().toISOString() });
		expect(parsed.author).toBeUndefined();
	});
});

describe("commentDomainDefinition", () => {
	it("has the expected topology shape without discourse property", () => {
		const t = commentDomainDefinition.topology;
		if (!t) throw new Error("commentDomainDefinition must declare topology");
		expect(t.vertexLabel).toBe(COMMENT_LABEL);
		expect(t.id).toBe("id");
		expect((t.properties as Record<string, unknown>).discourse).toBeUndefined();
		expect(t.properties.author).toBe(LinkRelations.ATTRIBUTED_TO.rel);
	});

	it("passes buildConcernCatalog validation", () => {
		const registered = { comment: { ...commentDomainDefinition, coerce: (x: unknown) => x as unknown as import("./resources.js").TDomainDefinition["schema"] } };
		const cat = buildConcernCatalog(registered as Parameters<typeof buildConcernCatalog>[0]);
		expect(cat.vertices[COMMENT_LABEL]).toBeDefined();
	});
});

describe("isSubPropertyOf", () => {
	it("returns true for the rel itself (reflexive)", () => {
		expect(isSubPropertyOf("inReplyTo", "inReplyTo")).toBe(true);
	});

	it("returns true for declared sub-properties of inReplyTo", () => {
		expect(isSubPropertyOf("wasInformedBy", "inReplyTo")).toBe(true);
		expect(isSubPropertyOf("invalidated", "inReplyTo")).toBe(true);
		expect(isSubPropertyOf("wasStartedBy", "inReplyTo")).toBe(true);
		expect(isSubPropertyOf("madeBySensor", "inReplyTo")).toBe(true);
	});

	it("returns true for discourse rels as sub-properties of inReplyTo", () => {
		expect(isSubPropertyOf("narrate", "inReplyTo")).toBe(true);
		expect(isSubPropertyOf("petition", "inReplyTo")).toBe(true);
		expect(isSubPropertyOf("grant", "inReplyTo")).toBe(true);
	});

	it("returns false for unrelated rels", () => {
		expect(isSubPropertyOf("name", "inReplyTo")).toBe(false);
		expect(isSubPropertyOf("hasBody", "inReplyTo")).toBe(false);
		expect(isSubPropertyOf("attributedTo", "inReplyTo")).toBe(false);
	});

	it("returns false for unknown rels", () => {
		expect(isSubPropertyOf("totallyMadeUp", "inReplyTo")).toBe(false);
	});
});

describe("isReplyEdge — generic chain walk", () => {
	it("recognises inReplyTo and its declared sub-properties", () => {
		expect(isReplyEdge("inReplyTo")).toBe(true);
		expect(isReplyEdge("wasInformedBy")).toBe(true);
		expect(isReplyEdge("invalidated")).toBe(true);
		expect(isReplyEdge("wasStartedBy")).toBe(true);
		expect(isReplyEdge("madeBySensor")).toBe(true);
	});

	it("recognises discourse rels as reply edges", () => {
		expect(isReplyEdge("narrate")).toBe(true);
		expect(isReplyEdge("measure")).toBe(true);
		expect(isReplyEdge("petition")).toBe(true);
	});

	it("resolves predicate names through EdgePredicates", () => {
		expect(isReplyEdge("inReplyTo")).toBe(true);
	});

	it("rejects non-reply rels", () => {
		expect(isReplyEdge("hasBody")).toBe(false);
		expect(isReplyEdge("attributedTo")).toBe(false);
		expect(isReplyEdge("name")).toBe(false);
	});
});

describe("getPropertyDefinitions", () => {
	it("emits one record per LinkRelations entry", () => {
		const defs = getPropertyDefinitions();
		expect(defs.length).toBe(Object.keys(LinkRelations).length);
	});

	it("each record has id = rel name and iri = rel uri", () => {
		const defs = getPropertyDefinitions();
		const inReplyTo = defs.find((r) => r.id === LinkRelations.IN_REPLY_TO.rel);
		expect(inReplyTo).toBeDefined();
		expect(inReplyTo?.iri).toBe(LinkRelations.IN_REPLY_TO.uri);
		expect(inReplyTo?.range).toBe("iri");
	});

	it("propagates subPropertyOf for declared sub-properties", () => {
		const defs = getPropertyDefinitions();
		const wasInformedBy = defs.find((r) => r.id === "wasInformedBy");
		expect(wasInformedBy?.subPropertyOf).toBe("inReplyTo");
	});

	it("propagates subPropertyOf for discourse rels", () => {
		const defs = getPropertyDefinitions();
		for (const rel of DISCOURSE_RELS) {
			expect(defs.find((r) => r.id === rel)?.subPropertyOf).toBe("inReplyTo");
		}
	});

	it("propagates label and icon for discourse rels", () => {
		const defs = getPropertyDefinitions();
		const narrate = defs.find((r) => r.id === "narrate");
		expect(narrate?.label).toBeTruthy();
		expect(narrate?.icon).toBeTruthy();
	});

	it("propagates presentation for rels that declare it", () => {
		const defs = getPropertyDefinitions();
		expect(defs.find((r) => r.id === "hasBody")?.presentation).toBe("body");
		expect(defs.find((r) => r.id === "accessLevel")?.presentation).toBe("governance");
		expect(defs.find((r) => r.id === "name")?.presentation).toBe("summary");
	});

	it("leaves optional fields absent for rels that don't declare them", () => {
		const defs = getPropertyDefinitions();
		const audience = defs.find((r) => r.id === LinkRelations.AUDIENCE.rel);
		expect(audience?.subPropertyOf).toBeUndefined();
		expect(audience?.presentation).toBeUndefined();
		expect(audience?.label).toBeUndefined();
		expect(audience?.icon).toBeUndefined();
	});

	it("includes the new RDFS rels themselves (subPropertyOf, label, range, icon, presentation)", () => {
		const defs = getPropertyDefinitions();
		const ids = new Set(defs.map((r) => r.id));
		expect(ids.has("subPropertyOf")).toBe(true);
		expect(ids.has("label")).toBe(true);
		expect(ids.has("range")).toBe(true);
		expect(ids.has("icon")).toBe(true);
		expect(ids.has("presentation")).toBe(true);
	});
});
