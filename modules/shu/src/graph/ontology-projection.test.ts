import { describe, it, expect } from "vitest";
import { ontologyToQuads, ONTOLOGY_CLASS, ONTOLOGY_PROPERTY, ONTOLOGY_PRED, pruneOntologyToUse, withOntologySchema, scopeSchemaToType, isSchemaType, propertyVocabulary, isHaibunTerm, typesDeclaringRel } from "./ontology-projection.js";
import { LinkRelations, principalDomainDefinition, HAIBUN_NS, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const edge = (quads: ReturnType<typeof ontologyToQuads>["quads"], predicate: string, from: string, to: string): boolean =>
	quads.some((q) => q.predicate === predicate && q.subject === from && q.object === to && q.objectType !== undefined);

describe("ontologyToQuads — the schema rendered as a graph", () => {
	it("emits the directional role hierarchy as subPropertyOf edges (issuer → fromActor → inRoleOf)", () => {
		const { quads, clusters } = ontologyToQuads();
		expect(edge(quads, ONTOLOGY_PRED.subPropertyOf, "issuer", "fromActor")).toBe(true);
		expect(edge(quads, ONTOLOGY_PRED.subPropertyOf, "fromActor", "inRoleOf")).toBe(true);
		expect(edge(quads, ONTOLOGY_PRED.subPropertyOf, "credentialSubject", "toActor")).toBe(true);
		expect(edge(quads, ONTOLOGY_PRED.subPropertyOf, "toActor", "inRoleOf")).toBe(true);
		// the abstract super-properties are nodes in the Property cluster (the interesting structure)
		const props = clusters.find((c) => c.type === ONTOLOGY_PROPERTY);
		for (const rel of ["inRoleOf", "fromActor", "toActor", "issuer", "credentialSubject"]) expect(props?.sampledSubjects).toContain(rel);
	});

	it("flags the abstract super-properties so a view can distinguish them from concrete edge labels", () => {
		const { quads } = ontologyToQuads();
		const abstractOf = (rel: string): boolean => quads.some((q) => q.subject === rel && q.predicate === ONTOLOGY_PRED.abstract && q.object === true);
		expect(abstractOf("inRoleOf")).toBe(true);
		expect(abstractOf("fromActor")).toBe(true);
		expect(abstractOf("issuer")).toBe(false); // concrete — a real written edge label
	});

	it("emits a class node per persisted type with its subClassOf superclass (Principal → prov:Agent)", () => {
		const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
		const { quads, clusters } = ontologyToQuads(domains);
		const classes = clusters.find((c) => c.type === ONTOLOGY_CLASS);
		expect(classes?.sampledSubjects).toContain("Principal");
		expect(classes?.sampledSubjects).toContain("prov:Agent"); // the superclass is its own node
		expect(edge(quads, ONTOLOGY_PRED.subClassOf, "Principal", "prov:Agent")).toBe(true);
	});

	it("renders the property hierarchy even with no domains (LinkRelations alone)", () => {
		const { clusters } = ontologyToQuads();
		expect(clusters.find((c) => c.type === ONTOLOGY_PROPERTY)?.sampledCount).toBeGreaterThan(10);
		expect(clusters.find((c) => c.type === ONTOLOGY_CLASS)?.sampledCount).toBe(0);
	});

	it("carries a domain (rdfs:domain) on a property a type declares — the instances-drill routing (and none for an abstract super-property)", () => {
		const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
		// delegatedFrom is an edge Principal declares, so its rdfs:domain includes Principal.
		expect(typesDeclaringRel(domains, LinkRelations.DELEGATED_FROM.rel)).toContain("Principal");
		const { quads } = ontologyToQuads(domains);
		const domainOf = (rel: string): unknown => quads.find((q) => q.subject === rel && q.predicate === ONTOLOGY_PRED.domain)?.object;
		expect(domainOf(LinkRelations.DELEGATED_FROM.rel)).toBe("Principal");
		// an abstract super-property no type declares has no instances to drill to → no domain.
		expect(domainOf(LinkRelations.IN_ROLE_OF.rel)).toBeUndefined();
		expect(typesDeclaringRel(domains, LinkRelations.IN_ROLE_OF.rel)).toEqual([]);
	});

	it("carries a range (rdfs:range) on each edge — the class it points at, so the ontology reads class→property→class", () => {
		const domains = {
			w: { topology: { persistedAs: "Widget", id: "id", properties: { id: LinkRelations.IDENTIFIER.rel }, edges: { maker: { range: "Person", rel: LinkRelations.ATTRIBUTED_TO.rel } } }, schema: { parse: (v: unknown) => v } } as unknown as TRegisteredDomain,
		};
		const { quads, clusters } = ontologyToQuads(domains);
		// the edge's target class is a drawn Property→Class edge, and the range class is its own node.
		expect(edge(quads, ONTOLOGY_PRED.range, LinkRelations.ATTRIBUTED_TO.rel, "Person")).toBe(true);
		expect(clusters.find((c) => c.type === ONTOLOGY_CLASS)?.sampledSubjects).toContain("Person");
	});
});

describe("pruneOntologyToUse — the served schema is the part the data exercises", () => {
	const schemaTerm: TQuad = { subject: "VerifiableCredential", predicate: ONTOLOGY_PRED.name, object: "VerifiableCredential", namedGraph: ONTOLOGY_CLASS, timestamp: 0 };
	const superTerm: TQuad = { subject: "VerifiableCredential", predicate: ONTOLOGY_PRED.subClassOf, object: "prov:Entity", namedGraph: ONTOLOGY_CLASS, objectType: ONTOLOGY_CLASS, timestamp: 0 };
	const superName: TQuad = { subject: "prov:Entity", predicate: ONTOLOGY_PRED.name, object: "prov:Entity", namedGraph: ONTOLOGY_CLASS, timestamp: 0 };
	const unusedTerm: TQuad = { subject: "NeverInstantiated", predicate: ONTOLOGY_PRED.name, object: "NeverInstantiated", namedGraph: ONTOLOGY_CLASS, timestamp: 0 };
	const usedProp: TQuad = { subject: "issuer", predicate: ONTOLOGY_PRED.name, object: "issuer", namedGraph: ONTOLOGY_PROPERTY, timestamp: 0 };
	const instance: TQuad = { subject: "vc-1", predicate: "issuer", object: "did:x", namedGraph: "VerifiableCredential", timestamp: 0 };
	const ontology = {
		quads: [schemaTerm, superTerm, superName, unusedTerm, usedProp],
		clusters: [
			{ type: ONTOLOGY_CLASS, totalCount: 3, sampledCount: 3, omittedCount: 0, sampledSubjects: ["VerifiableCredential", "prov:Entity", "NeverInstantiated"], displayLabels: {} },
			{ type: ONTOLOGY_PROPERTY, totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["issuer"], displayLabels: {} },
		],
	};

	it("keeps a used Class (and its superclass) plus a used Property; drops a never-instantiated term — the evidence is the full data, so a types-narrowed request still receives the pruned schema", () => {
		const pruned = pruneOntologyToUse(ontology, [instance]);
		const subjects = pruned.quads.map((q) => q.subject);
		expect(subjects).toContain("VerifiableCredential"); // its instance exercises it
		expect(subjects).toContain("prov:Entity"); // a used leaf pulls in its ancestors
		expect(subjects).toContain("issuer"); // the instance's predicate
		expect(subjects).not.toContain("NeverInstantiated");
	});

	it("cluster counts match the pruned subjects so the chips read the exercised subset", () => {
		const pruned = pruneOntologyToUse(ontology, [instance]);
		const classes = pruned.clusters.find((c) => c.type === ONTOLOGY_CLASS);
		expect(classes?.sampledSubjects.sort()).toEqual(["VerifiableCredential", "prov:Entity"]);
		expect(classes?.totalCount).toBe(2);
		expect(pruned.clusters.find((c) => c.type === ONTOLOGY_PROPERTY)?.totalCount).toBe(1);
	});
});

describe("withOntologySchema — the schema travels with the response (live and offline alike)", () => {
	const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
	const instance: TQuad = { subject: "did:x", predicate: "delegatedFrom", object: "did:y", namedGraph: "Principal", timestamp: 5 };
	const response = { quads: [instance], clusters: [{ type: "Principal", totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["did:x"], displayLabels: {} }] };

	it("appends the pruned Class + Property clusters and an rdf:type edge per instance, keeping the instance data intact", () => {
		const out = withOntologySchema(response, response.quads, domains);
		expect(out.quads).toContain(instance); // instance data preserved
		// the Principal Class node is present (an instance exercises it)…
		expect(out.quads.some((q) => q.namedGraph === ONTOLOGY_CLASS && q.subject === "Principal")).toBe(true);
		// …and the instance is joined to its Class by an `a` edge living in the instance's own graph.
		const typeEdge = out.quads.find((q) => q.predicate === "a" && q.subject === "did:x");
		expect(typeEdge).toMatchObject({ object: "Principal", objectType: ONTOLOGY_CLASS, namedGraph: "Principal" });
		expect(out.clusters.some((c) => c.type === ONTOLOGY_CLASS)).toBe(true);
		expect(out.clusters.some((c) => c.type === ONTOLOGY_PROPERTY)).toBe(true);
	});

	it("adds exactly one rdf:type edge per subject, and none for a type with no Class node", () => {
		const twoOfAType: TQuad[] = [instance, { subject: "did:x", predicate: "name", object: "X", namedGraph: "Principal", timestamp: 5 }];
		const out = withOntologySchema({ quads: twoOfAType, clusters: response.clusters }, twoOfAType, domains);
		expect(out.quads.filter((q) => q.predicate === "a" && q.subject === "did:x")).toHaveLength(1);
		// every appended non-schema quad that is an `a` edge points at a real Class node
		const classNodes = new Set(out.quads.filter((q) => isSchemaType(q.namedGraph) && q.namedGraph === ONTOLOGY_CLASS).map((q) => q.subject));
		for (const e of out.quads.filter((q) => q.predicate === "a")) expect(classNodes.has(String(e.object))).toBe(true);
	});
});

describe("scopeSchemaToType — one type's own vocabulary", () => {
	const q = (subject: string, predicate: string, object: string, graph: string, objectType?: string): TQuad => ({ subject, predicate, object, namedGraph: graph, objectType, timestamp: 0 });
	const quads: TQuad[] = [
		q("Issuer", ONTOLOGY_PRED.name, "Issuer", ONTOLOGY_CLASS),
		q("Issuer", ONTOLOGY_PRED.subClassOf, "prov:Agent", ONTOLOGY_CLASS, ONTOLOGY_CLASS),
		q("prov:Agent", ONTOLOGY_PRED.name, "prov:Agent", ONTOLOGY_CLASS),
		q("did", ONTOLOGY_PRED.domain, "Issuer", ONTOLOGY_PROPERTY, ONTOLOGY_CLASS),
		q("did", ONTOLOGY_PRED.name, "did", ONTOLOGY_PROPERTY),
		q("Email", ONTOLOGY_PRED.name, "Email", ONTOLOGY_CLASS),
		q("hasBody", ONTOLOGY_PRED.domain, "Email", ONTOLOGY_PROPERTY, ONTOLOGY_CLASS),
		q("vc-1", "issuer", "did:x", "VerifiableCredential"),
	];

	it("keeps the type, its superclass, and its properties (their domain edges point at it) with their labels", () => {
		const scoped = scopeSchemaToType(quads, "Issuer");
		const subjects = new Set(scoped.filter((x) => isSchemaType(x.namedGraph)).map((x) => x.subject));
		expect([...subjects].sort()).toEqual(["Issuer", "did", "prov:Agent"]);
	});

	it("drops unrelated schema terms but passes non-schema quads through untouched", () => {
		const scoped = scopeSchemaToType(quads, "Issuer");
		expect(scoped.some((x) => x.subject === "Email" || x.subject === "hasBody")).toBe(false);
		expect(scoped.some((x) => x.subject === "vc-1")).toBe(true);
	});
});

describe("propertyVocabulary — a property's provenance from its IRI", () => {
	it("classifies haibun's own prefixes and namespace as haibun", () => {
		expect(propertyVocabulary("hbn:accessLevel")).toEqual({ source: "haibun", prefix: "haibun" });
		expect(propertyVocabulary(`${HAIBUN_NS}seqPath`)).toEqual({ source: "haibun", prefix: "haibun" });
		expect(isHaibunTerm("hbn:accessLevel")).toBe(true);
	});
	it("classifies every other vocabulary by its own prefix — standards and consumer vocabularies alike, no closed set", () => {
		expect(propertyVocabulary("cred:issuer")).toEqual({ source: "standard", prefix: "cred" });
		expect(propertyVocabulary("prov:generatedAtTime")).toEqual({ source: "standard", prefix: "prov" });
		expect(propertyVocabulary("as:name").source).toBe("standard");
		// a consumer's own sub-vocabulary is NOT haibun's — it is identified by its own prefix, not hardcoded anywhere.
		expect(propertyVocabulary("ex:SomeType")).toEqual({ source: "standard", prefix: "ex" });
		expect(isHaibunTerm("sec:proof")).toBe(false);
	});
});
