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
	principalDomainDefinition,
	PRINCIPAL_LABEL,
	roleRels,
	fromActorRels,
	toActorRels,
	HAIBUN_NS,
	haibunNsForHost,
} from "./resources.js";
import { RelSchema, getJsonLdContext, buildConcernCatalog } from "./hypermedia.js";
import { mapDefinitionsToDomains } from "./domains.js";

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

	it("isSubPropertyOf walks transitively to an indirect ancestor, not just the direct parent", () => {
		// wasAttributedTo → fromActor → inRoleOf: the walk must reach the grandparent, not stop at the direct parent.
		expect(isSubPropertyOf(LinkRelations.WAS_ATTRIBUTED_TO.rel, LinkRelations.FROM_ACTOR.rel)).toBe(true); // direct parent
		expect(isSubPropertyOf(LinkRelations.WAS_ATTRIBUTED_TO.rel, LinkRelations.IN_ROLE_OF.rel)).toBe(true); // two hops up
		expect(isSubPropertyOf(LinkRelations.STARTED_AT_TIME.rel, LinkRelations.GANTT_START.rel)).toBe(true); // a gantt time rel reaches its upper concept
		expect(isSubPropertyOf(LinkRelations.ENDED_AT_TIME.rel, LinkRelations.GANTT_END.rel)).toBe(true);
	});

	it("isSubPropertyOf does not reach an unrelated concept (a sibling parent is not a path to everything)", () => {
		expect(isSubPropertyOf(LinkRelations.STARTED_AT_TIME.rel, LinkRelations.GANTT_END.rel)).toBe(false);
		expect(isSubPropertyOf(LinkRelations.STARTED_AT_TIME.rel, LinkRelations.IN_REPLY_TO.rel)).toBe(false);
	});

	it("single-parent gantt rels reach their declared upper concept", () => {
		expect(isSubPropertyOf(LinkRelations.DURATION.rel, LinkRelations.GANTT_DURATION.rel)).toBe(true);
		expect(isSubPropertyOf(LinkRelations.EFFORT.rel, LinkRelations.GANTT_EFFORT.rel)).toBe(true);
		expect(isSubPropertyOf(LinkRelations.DEPENDS_ON.rel, LinkRelations.GANTT_DEPENDS.rel)).toBe(true);
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

describe("LinkRelations self-consistency — a class can never render as a super-property (§1b)", () => {
	const entries = Object.values(LinkRelations);
	const declaredRels = new Set(entries.map((e) => e.rel));

	it("every subPropertyOf target names a declared property rel (no dangling super-property)", () => {
		for (const e of entries) {
			const sp = (e as { subPropertyOf?: string | string[] }).subPropertyOf;
			for (const parent of sp === undefined ? [] : Array.isArray(sp) ? sp : [sp]) expect(declaredRels, `${e.rel} subPropertyOf ${parent}`).toContain(parent);
		}
	});

	it("every rel's URI is a PROPERTY, not a class (lowercase local name) — the temporalInstant category error stays out", () => {
		for (const e of entries) {
			const local = e.uri.split(/[:#/]/).pop() ?? "";
			if (local) expect(local, `${e.rel} → ${e.uri} must be a property (lowercase local name), never a class`).toBe(local[0].toLowerCase() + local.slice(1));
		}
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
		expect(ctx.hbn).toBe(HAIBUN_NS);
	});

	it("preserves pre-existing prefixes unchanged", () => {
		const out = getJsonLdContext({}) as { "@context": Record<string, unknown> };
		const ctx = out["@context"];
		expect(ctx.as).toBe("https://www.w3.org/ns/activitystreams#");
		expect(ctx.foaf).toBe("http://xmlns.com/foaf/0.1/");
		expect(ctx.dcterms).toBe("http://purl.org/dc/terms/");
		expect(ctx.haibun).toBeUndefined();
	});

	it("binds hbn under a given host, defaulting to the canonical stem", () => {
		expect((getJsonLdContext({}, haibunNsForHost("https://192.168.1.9:8223"))["@context"] as Record<string, unknown>).hbn).toBe("https://192.168.1.9:8223/ns/");
		expect((getJsonLdContext({})["@context"] as Record<string, unknown>).hbn).toBe(HAIBUN_NS);
	});

	it("declares the W3C standard credential vocabularies but names no consumer-coined vocabulary", () => {
		const out = getJsonLdContext({}) as { "@context": Record<string, unknown> };
		const ctx = out["@context"];
		// The genuine VC vocabulary namespace (VerifiableCredential/VerifiablePresentation/issuer/credentialSubject/holder/…),
		// used BY VC DM 2.0 — not a coined .../ns/credentials/v2# namespace, which hosts none of these terms.
		expect(ctx.cred).toBe("https://www.w3.org/2018/credentials#");
		// The W3C Bitstring Status List vocabulary, distinct from the core credentials vocabulary.
		expect(ctx.vcstatus).toBe("https://www.w3.org/ns/credentials/status#");
	});

	it("maps a property/edge to its declared genuine IRI, overriding the rel's default", () => {
		const domains = {
			c: {
				topology: {
					persistedAs: "Cred",
					type: "cred:VerifiableCredential",
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel, statusListIndex: { rel: LinkRelations.CONTEXT.rel, iri: "vcstatus:statusListIndex" } },
					edges: { credentialStatus: { range: "StatusList", rel: LinkRelations.CONTEXT.rel, iri: "cred:credentialStatus" } },
				},
				schema: { parse: (v: unknown) => v },
			},
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const ctx = (getJsonLdContext(domains) as { "@context": Record<string, { "@context": Record<string, { "@id": string }> }> })["@context"];
		const scope = ctx.Cred["@context"];
		expect(scope.statusListIndex["@id"]).toBe("vcstatus:statusListIndex");
		expect(scope.credentialStatus["@id"]).toBe("cred:credentialStatus");
	});

	it("merges a persisted domain's own namespace prefixes into the served context", () => {
		const domains = {
			x: { topology: { persistedAs: "X", type: "ex:X", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel }, namespaces: { ex: `${HAIBUN_NS}ex#` } }, schema: { parse: (v: unknown) => v } },
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const ctx = (getJsonLdContext(domains) as { "@context": Record<string, unknown> })["@context"];
		expect(ctx.ex).toBe(`${HAIBUN_NS}ex#`);
	});

	it("maps the credential validity-end rel to cred:validUntil (not as:updated)", () => {
		expect(LinkRelations.VALID_UNTIL.rel).toBe("validUntil");
		expect(LinkRelations.VALID_UNTIL.uri).toBe("cred:validUntil");
		expect(REL_CONTEXT.validUntil).toBe("cred:validUntil");
		expect(getRelRange(LinkRelations.VALID_UNTIL.rel)).toBe("literal");
	});
});

describe("getJsonLdContext top-level term fallback", () => {
	const persistedDomain = (persistedAs: string, type: string, properties: Record<string, string>) => ({
		topology: { persistedAs, type, id: "id", concerns: { persisted: true }, properties: { id: LinkRelations.IDENTIFIER.rel, ...properties } },
		schema: { parse: (v: unknown) => v },
	});

	it("emits a top-level term when every domain agrees on its @id", () => {
		const domains = {
			a: persistedDomain("A", "vc:A", { name: LinkRelations.NAME.rel }),
			b: persistedDomain("B", "vc:B", { name: LinkRelations.NAME.rel }),
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const ctx = (getJsonLdContext(domains) as { "@context": Record<string, { "@id": string }> })["@context"];
		expect(ctx.name["@id"]).toBe(LinkRelations.NAME.uri);
	});

	it("omits a top-level term that maps to differing @ids across domains", () => {
		const domains = {
			cred: persistedDomain("Credential", "vc:VerifiableCredential", { issuer: LinkRelations.CREDENTIAL_ISSUER.rel }),
			list: persistedDomain("TrustedList", "ex:TrustedList", { issuer: LinkRelations.TAG.rel }),
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const ctx = (getJsonLdContext(domains) as { "@context": Record<string, unknown> })["@context"];
		expect(ctx.issuer).toBeUndefined();
		// still resolvable under each type's scoped @context
		const credScope = (ctx.Credential as { "@context": Record<string, { "@id": string }> })["@context"];
		const listScope = (ctx.TrustedList as { "@context": Record<string, { "@id": string }> })["@context"];
		expect(credScope.issuer["@id"]).toBe(LinkRelations.CREDENTIAL_ISSUER.uri);
		expect(listScope.issuer["@id"]).toBe(LinkRelations.TAG.uri);
	});
});

describe("getJsonLdContext ontology @graph — rdfs:subClassOf as a real RDF statement, not a @context keyword", () => {
	it("states the type's subclass on its class node in @graph; the @context term stays a pure IRI mapping", () => {
		const domains = {
			p: {
				topology: { persistedAs: "P", type: "sec:Controller", subClassOf: "prov:Agent", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
				schema: { parse: (v: unknown) => v },
			},
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const out = getJsonLdContext(domains) as { "@context": Record<string, Record<string, unknown>>; "@graph": Array<Record<string, unknown>> };
		expect(out["@context"].P["@id"]).toBe("sec:Controller");
		expect(out["@context"].P).not.toHaveProperty("rdfs:subClassOf"); // an ontology keyword would make the term definition invalid
		const classNode = out["@graph"].find((n) => n["@id"] === "sec:Controller");
		expect(classNode?.["@type"]).toBe("rdfs:Class");
		expect(classNode?.["rdfs:subClassOf"]).toEqual({ "@id": "prov:Agent" });
	});

	it("omits rdfs:subClassOf from the class node when a type declares no superclass", () => {
		const domains = {
			a: { topology: { persistedAs: "A", type: "vc:A", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } }, schema: { parse: (v: unknown) => v } },
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const out = getJsonLdContext(domains) as { "@graph": Array<Record<string, unknown>> };
		const classNode = out["@graph"].find((n) => n["@id"] === "vc:A");
		expect(classNode?.["@type"]).toBe("rdfs:Class");
		expect(classNode).not.toHaveProperty("rdfs:subClassOf");
	});

	it("the Principal (sec:Controller) class node is declared a prov:Agent — the wasAttributedTo target is well-formed", () => {
		const domains = mapDefinitionsToDomains([principalDomainDefinition]);
		const out = getJsonLdContext(domains) as { "@context": Record<string, { "@id": string }>; "@graph": Array<Record<string, unknown>> };
		expect(out["@context"][PRINCIPAL_LABEL]["@id"]).toBe("sec:Controller");
		expect(out["@graph"].find((n) => n["@id"] === "sec:Controller")?.["rdfs:subClassOf"]).toEqual({ "@id": "prov:Agent" });
	});
});

describe("roleRels — the ontology-derived role-attribution predicate set", () => {
	it("derives every rel declared subPropertyOf inRoleOf (and excludes the super-property itself)", () => {
		const set = roleRels();
		for (const rel of [
			LinkRelations.REGISTERED_IN.rel,
			LinkRelations.CREDENTIAL_HOLDER.rel,
			LinkRelations.CREDENTIAL_ISSUER.rel,
			LinkRelations.CREDENTIAL_SUBJECT.rel,
			LinkRelations.PERFORMED_BY.rel,
			LinkRelations.VERIFIER.rel,
			LinkRelations.AUTHOR.rel,
			LinkRelations.WAS_ATTRIBUTED_TO.rel,
			LinkRelations.ATTRIBUTED_TO.rel,
		]) {
			expect(set.has(rel)).toBe(true);
		}
		expect(set.has(LinkRelations.IN_ROLE_OF.rel)).toBe(false); // the abstract super-property is never a written edge
		expect(set.has(LinkRelations.IN_REPLY_TO.rel)).toBe(false); // a reply rel is not a role attribution
	});

	it("treats prov:wasAttributedTo as a SUB-property of inRoleOf, not the reverse (a role target need not be a prov:Agent)", () => {
		expect(isSubPropertyOf(LinkRelations.WAS_ATTRIBUTED_TO.rel, LinkRelations.IN_ROLE_OF.rel)).toBe(true);
		expect(isSubPropertyOf(LinkRelations.IN_ROLE_OF.rel, LinkRelations.WAS_ATTRIBUTED_TO.rel)).toBe(false);
		expect(isSubPropertyOf(LinkRelations.REGISTERED_IN.rel, LinkRelations.WAS_ATTRIBUTED_TO.rel)).toBe(false); // registeredIn is a role attribution but NOT a prov:wasAttributedTo
	});
});

describe("fromActor / toActor — the directional actor split under inRoleOf", () => {
	it("a concrete actor rel reaches inRoleOf TRANSITIVELY through its direction (issuer → fromActor → inRoleOf)", () => {
		expect(isSubPropertyOf(LinkRelations.CREDENTIAL_ISSUER.rel, LinkRelations.FROM_ACTOR.rel)).toBe(true);
		expect(isSubPropertyOf(LinkRelations.FROM_ACTOR.rel, LinkRelations.IN_ROLE_OF.rel)).toBe(true);
		expect(isSubPropertyOf(LinkRelations.CREDENTIAL_ISSUER.rel, LinkRelations.IN_ROLE_OF.rel)).toBe(true); // so it is still a role rel
		expect(isSubPropertyOf(LinkRelations.CREDENTIAL_SUBJECT.rel, LinkRelations.TO_ACTOR.rel)).toBe(true);
	});

	it("the split only ADDS direction — roleRels membership is unchanged (every actor rel is still a role)", () => {
		const roles = roleRels();
		for (const r of [...fromActorRels(), ...toActorRels()]) expect(roles.has(r)).toBe(true);
	});

	it("sorts the source-side actors (issuer/holder/author/performedBy/attributedTo/wasAttributedTo) into fromActor", () => {
		const from = fromActorRels();
		for (const r of [
			LinkRelations.CREDENTIAL_ISSUER.rel,
			LinkRelations.CREDENTIAL_HOLDER.rel,
			LinkRelations.AUTHOR.rel,
			LinkRelations.PERFORMED_BY.rel,
			LinkRelations.ATTRIBUTED_TO.rel,
			LinkRelations.WAS_ATTRIBUTED_TO.rel,
		])
			expect(from.has(r)).toBe(true);
		// and not the target-side ones
		expect(from.has(LinkRelations.CREDENTIAL_SUBJECT.rel)).toBe(false);
		expect(from.has(LinkRelations.REGISTERED_IN.rel)).toBe(false);
	});

	it("sorts the target-side actors (credentialSubject/verifier/registeredIn) into toActor", () => {
		const to = toActorRels();
		for (const r of [LinkRelations.CREDENTIAL_SUBJECT.rel, LinkRelations.VERIFIER.rel, LinkRelations.REGISTERED_IN.rel]) expect(to.has(r)).toBe(true);
		expect(to.has(LinkRelations.CREDENTIAL_ISSUER.rel)).toBe(false);
	});

	it("excludes the abstract concepts themselves from every derived set (they classify, never an edge label)", () => {
		for (const set of [roleRels(), fromActorRels(), toActorRels()])
			for (const abstractRel of [LinkRelations.IN_ROLE_OF.rel, LinkRelations.FROM_ACTOR.rel, LinkRelations.TO_ACTOR.rel]) expect(set.has(abstractRel)).toBe(false);
	});
});

describe("getJsonLdContext ontology @graph — rdfs:subPropertyOf as a real RDF statement, not a @context keyword", () => {
	it("states a role edge's super-property on its property node in @graph; the scoped @context term stays a pure IRI mapping", () => {
		const domains = {
			c: {
				topology: {
					persistedAs: "C",
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel },
					edges: { issuer: { rel: LinkRelations.CREDENTIAL_ISSUER.rel, range: "Principal" } },
				},
				schema: { parse: (v: unknown) => v },
			},
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const out = getJsonLdContext(domains) as { "@context": Record<string, { "@context"?: Record<string, Record<string, unknown>> }>; "@graph": Array<Record<string, unknown>> };
		expect(out["@context"].C["@context"]?.issuer).not.toHaveProperty("rdfs:subPropertyOf"); // an ontology keyword would make the term definition invalid
		// issuer declares under the directional fromActor super-property (itself subPropertyOf inRoleOf), stated on its property node.
		const issuerNode = out["@graph"].find((n) => n["@id"] === REL_CONTEXT[LinkRelations.CREDENTIAL_ISSUER.rel]);
		expect(issuerNode?.["@type"]).toBe("rdf:Property");
		expect(issuerNode?.["rdfs:subPropertyOf"]).toEqual({ "@id": REL_CONTEXT[LinkRelations.FROM_ACTOR.rel] });
	});

	it("omits rdfs:subPropertyOf from a property node whose rel declares no parent", () => {
		const domains = {
			a: { topology: { persistedAs: "A", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel } }, schema: { parse: (v: unknown) => v } },
		} as unknown as Parameters<typeof getJsonLdContext>[0];
		const out = getJsonLdContext(domains) as { "@graph": Array<Record<string, unknown>> };
		expect(out["@graph"].find((n) => n["@id"] === REL_CONTEXT[LinkRelations.NAME.rel])).not.toHaveProperty("rdfs:subPropertyOf");
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
		body: "hello",
		generatedAtTime: new Date().toISOString(),
	};

	it("accepts a minimal valid Comment without discourse property", () => {
		expect(() => CommentSchema.parse({ id: "c1", author: "stepper:llm", generatedAtTime: new Date().toISOString() })).not.toThrow();
	});

	it("accepts an author", () => {
		const withAuthor = { ...baseComment, author: "stepper:llm" };
		const parsed = CommentSchema.parse(withAuthor);
		expect(parsed.author).toBe("stepper:llm");
	});

	it("requires an author — every Comment is attributed", () => {
		expect(() => CommentSchema.parse({ id: "c1", generatedAtTime: new Date().toISOString() })).toThrow();
	});
});

describe("commentDomainDefinition", () => {
	it("has the expected topology shape without discourse property", () => {
		const t = commentDomainDefinition.topology;
		if (!t) throw new Error("commentDomainDefinition must declare topology");
		expect(t.persistedAs).toBe(COMMENT_LABEL);
		expect(t.id).toBe("id");
		expect((t.properties as Record<string, unknown>).discourse).toBeUndefined();
		expect(t.properties.author).toBe(LinkRelations.ATTRIBUTED_TO.rel);
	});

	it("passes buildConcernCatalog validation", () => {
		const registered = { comment: { ...commentDomainDefinition, coerce: (x: unknown) => x as unknown as import("./resources.js").TDomainDefinition["schema"] } };
		const cat = buildConcernCatalog(registered as Parameters<typeof buildConcernCatalog>[0]);
		expect(cat.persisted[COMMENT_LABEL]).toBeDefined();
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
