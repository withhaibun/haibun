import { describe, it, expect } from "vitest";
import { pruneOntologyToUse, withOntologySchema, scopeSchemaToType, isSchemaType, propertyVocabulary, isHaibunTerm } from "./ontology-projection.js";
import { categoryOf, ontologyToQuads, typesDeclaringRel } from "@haibun/core/lib/records/derivations/ontology.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/domains/resources.js";
import { LinkRelations, principalDomainDefinition, HAIBUN_NS, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const edge = (quads: ReturnType<typeof ontologyToQuads>["quads"], predicate: string, from: string, to: string): boolean =>
	quads.some((q) => q.predicate === predicate && q.subject === from && q.object === to && q.objectType !== undefined);

describe("ontologyToQuads: the schema rendered as a graph", () => {
	it("emits the directional role hierarchy as subPropertyOf edges (performedBy → fromActor → inRoleOf)", () => {
		const { quads, clusters } = ontologyToQuads({});
		expect(edge(quads, ONTOLOGY_FIELD.subPropertyOf, "performedBy", "fromActor")).toBe(true);
		expect(edge(quads, ONTOLOGY_FIELD.subPropertyOf, "fromActor", "inRoleOf")).toBe(true);
		// toActor doesn't have a concrete CORE rel, consumers declare theirs against it; the upper pointer itself is projected
		expect(edge(quads, ONTOLOGY_FIELD.subPropertyOf, "toActor", "inRoleOf")).toBe(true);
		// the abstract super-properties are nodes in the Property cluster (the interesting structure)
		const props = clusters.find((c) => c.type === PROPERTY_LABEL);
		for (const rel of ["inRoleOf", "fromActor", "toActor", "performedBy", "author"]) expect(props?.sampledSubjects).toContain(rel);
	});

	it("flags the abstract super-properties so a view can distinguish them from concrete edge labels", () => {
		const { quads } = ontologyToQuads({});
		const abstractOf = (rel: string): boolean => quads.some((q) => q.subject === rel && q.predicate === ONTOLOGY_FIELD.abstract && q.object === true);
		expect(abstractOf("inRoleOf")).toBe(true);
		expect(abstractOf("fromActor")).toBe(true);
		expect(abstractOf("performedBy")).toBe(false); // concrete: a real written edge label
	});

	it("emits a class node per persisted type with its subClassOf superclass (Principal → prov:Agent)", () => {
		const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
		const { quads, clusters } = ontologyToQuads(domains);
		const classes = clusters.find((c) => c.type === CLASS_LABEL);
		expect(classes?.sampledSubjects).toContain("Principal");
		expect(classes?.sampledSubjects).toContain("prov:Agent"); // the superclass is its own node
		expect(edge(quads, ONTOLOGY_FIELD.subClassOf, "Principal", "prov:Agent")).toBe(true);
	});

	it("states a declared type's Class record with its domain's description, and leaves a standard-vocabulary superclass undescribed", () => {
		const { quads } = ontologyToQuads({ p: principalDomainDefinition as unknown as TRegisteredDomain });
		const descriptionOf = (cls: string): unknown => quads.find((q) => q.subject === cls && q.predicate === ONTOLOGY_FIELD.description && q.namedGraph === CLASS_LABEL)?.object;
		expect(descriptionOf("Principal")).toBe(principalDomainDefinition.description);
		expect(descriptionOf("prov:Agent")).toBeUndefined();
	});

	it("renders the property hierarchy even without domains (LinkRelations alone)", () => {
		const { clusters } = ontologyToQuads({});
		expect(clusters.find((c) => c.type === PROPERTY_LABEL)?.sampledCount).toBeGreaterThan(10);
		expect(clusters.find((c) => c.type === CLASS_LABEL)?.sampledCount).toBe(0);
	});

	it("carries a domain (rdfs:domain) on a property a type declares: the instances-drill routing (and doesn't carry one for an abstract super-property)", () => {
		const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
		// service is an edge Principal declares, so its rdfs:domain includes Principal.
		expect(typesDeclaringRel(domains, LinkRelations.SERVICE.rel)).toContain("Principal");
		const { quads } = ontologyToQuads(domains);
		const domainOf = (rel: string): unknown => quads.find((q) => q.subject === rel && q.predicate === ONTOLOGY_FIELD.domain)?.object;
		expect(domainOf(LinkRelations.SERVICE.rel)).toBe("Principal");
		// an abstract super-property that the types don't declare doesn't have instances to drill to → it doesn't carry a domain.
		expect(domainOf(LinkRelations.IN_ROLE_OF.rel)).toBeUndefined();
		expect(typesDeclaringRel(domains, LinkRelations.IN_ROLE_OF.rel)).toEqual([]);
	});

	it("carries a range (rdfs:range) on each edge: the class it points at, so the ontology reads class→property→class", () => {
		const domains = {
			w: {
				topology: {
					persistedAs: "Widget",
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel },
					edges: { maker: { range: "Person", rel: LinkRelations.ATTRIBUTED_TO.rel } },
				},
				schema: { parse: (v: unknown) => v },
			} as unknown as TRegisteredDomain,
		};
		const { quads, clusters } = ontologyToQuads(domains);
		// the edge's target class is a drawn Property→Class edge, and the range class is its own node.
		expect(edge(quads, ONTOLOGY_FIELD.range, LinkRelations.ATTRIBUTED_TO.rel, "Person")).toBe(true);
		expect(clusters.find((c) => c.type === CLASS_LABEL)?.sampledSubjects).toContain("Person");
	});
});

describe("pruneOntologyToUse: the served schema is the part the data exercises", () => {
	const schemaTerm: TQuad = { subject: "Document", predicate: ONTOLOGY_FIELD.name, object: "Document", namedGraph: CLASS_LABEL, timestamp: 0 };
	const superTerm: TQuad = { subject: "Document", predicate: ONTOLOGY_FIELD.subClassOf, object: "prov:Entity", namedGraph: CLASS_LABEL, objectType: CLASS_LABEL, timestamp: 0 };
	const superName: TQuad = { subject: "prov:Entity", predicate: ONTOLOGY_FIELD.name, object: "prov:Entity", namedGraph: CLASS_LABEL, timestamp: 0 };
	const unusedTerm: TQuad = { subject: "NeverInstantiated", predicate: ONTOLOGY_FIELD.name, object: "NeverInstantiated", namedGraph: CLASS_LABEL, timestamp: 0 };
	const usedProp: TQuad = { subject: "issuer", predicate: ONTOLOGY_FIELD.name, object: "issuer", namedGraph: PROPERTY_LABEL, timestamp: 0 };
	const instance: TQuad = { subject: "doc-1", predicate: "issuer", object: "did:x", namedGraph: "Document", timestamp: 0 };
	const ontology = {
		quads: [schemaTerm, superTerm, superName, unusedTerm, usedProp],
		clusters: [
			{ type: CLASS_LABEL, totalCount: 3, sampledCount: 3, omittedCount: 0, sampledSubjects: ["Document", "prov:Entity", "NeverInstantiated"], displayLabels: {} },
			{ type: PROPERTY_LABEL, totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["issuer"], displayLabels: {} },
		],
	};

	it("keeps a used Class (and its superclass) plus a used Property; drops a never-instantiated term: the evidence is the full data, so a types-narrowed request still receives the pruned schema", () => {
		const pruned = pruneOntologyToUse(ontology, [instance]);
		const subjects = pruned.quads.map((q) => q.subject);
		expect(subjects).toContain("Document"); // its instance exercises it
		expect(subjects).toContain("prov:Entity"); // a used leaf pulls in its ancestors
		expect(subjects).toContain("issuer"); // the instance's predicate
		expect(subjects).not.toContain("NeverInstantiated");
	});

	it("cluster counts match the pruned subjects so the chips read the exercised subset", () => {
		const pruned = pruneOntologyToUse(ontology, [instance]);
		const classes = pruned.clusters.find((c) => c.type === CLASS_LABEL);
		expect(classes?.sampledSubjects.sort()).toEqual(["Document", "prov:Entity"]);
		expect(classes?.totalCount).toBe(2);
		expect(pruned.clusters.find((c) => c.type === PROPERTY_LABEL)?.totalCount).toBe(1);
	});
});

describe("withOntologySchema: the schema travels with the response (live and offline alike)", () => {
	const domains = { p: principalDomainDefinition as unknown as TRegisteredDomain };
	const instance: TQuad = { subject: "did:x", predicate: "service", object: "/rpc", namedGraph: "Principal", timestamp: 5 };
	const response = { quads: [instance], clusters: [{ type: "Principal", totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["did:x"], displayLabels: {} }] };

	it("appends the pruned Class + Property clusters and an rdf:type edge per instance, keeping the instance data intact", () => {
		const out = withOntologySchema(response, response.quads, domains);
		expect(out.quads).toContain(instance); // instance data preserved
		// the Principal Class node is present (an instance exercises it)…
		expect(out.quads.some((q) => q.namedGraph === CLASS_LABEL && q.subject === "Principal")).toBe(true);
		// …and the instance is joined to its Class by an `a` edge in the instance's own graph.
		const typeEdge = out.quads.find((q) => q.predicate === "a" && q.subject === "did:x");
		expect(typeEdge).toMatchObject({ object: "Principal", objectType: CLASS_LABEL, namedGraph: "Principal" });
		expect(out.clusters.some((c) => c.type === CLASS_LABEL)).toBe(true);
		expect(out.clusters.some((c) => c.type === PROPERTY_LABEL)).toBe(true);
	});

	it("adds exactly one rdf:type edge per subject, and doesn't add one for a type without a Class node", () => {
		const twoOfAType: TQuad[] = [instance, { subject: "did:x", predicate: "name", object: "X", namedGraph: "Principal", timestamp: 5 }];
		const out = withOntologySchema({ quads: twoOfAType, clusters: response.clusters }, twoOfAType, domains);
		expect(out.quads.filter((q) => q.predicate === "a" && q.subject === "did:x")).toHaveLength(1);
		// every appended non-schema quad that is an `a` edge points at a real Class node
		const classNodes = new Set(out.quads.filter((q) => isSchemaType(q.namedGraph) && q.namedGraph === CLASS_LABEL).map((q) => q.subject));
		for (const e of out.quads.filter((q) => q.predicate === "a")) expect(classNodes.has(String(e.object))).toBe(true);
	});
});

describe("scopeSchemaToType: one type's own vocabulary", () => {
	const q = (subject: string, predicate: string, object: string, graph: string, objectType?: string): TQuad => ({
		subject,
		predicate,
		object,
		namedGraph: graph,
		objectType,
		timestamp: 0,
	});
	const quads: TQuad[] = [
		q("Issuer", ONTOLOGY_FIELD.name, "Issuer", CLASS_LABEL),
		q("Issuer", ONTOLOGY_FIELD.subClassOf, "prov:Agent", CLASS_LABEL, CLASS_LABEL),
		q("prov:Agent", ONTOLOGY_FIELD.name, "prov:Agent", CLASS_LABEL),
		q("did", ONTOLOGY_FIELD.domain, "Issuer", PROPERTY_LABEL, CLASS_LABEL),
		q("did", ONTOLOGY_FIELD.name, "did", PROPERTY_LABEL),
		q("Email", ONTOLOGY_FIELD.name, "Email", CLASS_LABEL),
		q("hasBody", ONTOLOGY_FIELD.domain, "Email", PROPERTY_LABEL, CLASS_LABEL),
		q("doc-1", "issuer", "did:x", "Document"),
	];

	it("keeps the type, its superclass, and its properties (their domain edges point at it) with their labels", () => {
		const scoped = scopeSchemaToType(quads, "Issuer");
		const subjects = new Set(scoped.filter((x) => isSchemaType(x.namedGraph)).map((x) => x.subject));
		expect([...subjects].sort()).toEqual(["Issuer", "did", "prov:Agent"]);
	});

	it("drops unrelated schema terms but passes non-schema quads through untouched", () => {
		const scoped = scopeSchemaToType(quads, "Issuer");
		expect(scoped.some((x) => x.subject === "Email" || x.subject === "hasBody")).toBe(false);
		expect(scoped.some((x) => x.subject === "doc-1")).toBe(true);
	});
});

describe("propertyVocabulary: a property's provenance from its IRI", () => {
	it("classifies haibun's own prefixes and namespace as haibun", () => {
		expect(propertyVocabulary("hbn:accessLevel")).toEqual({ source: "haibun", prefix: "haibun" });
		expect(propertyVocabulary(`${HAIBUN_NS}seqPath`)).toEqual({ source: "haibun", prefix: "haibun" });
		expect(isHaibunTerm("hbn:accessLevel")).toBe(true);
	});
	it("classifies every other vocabulary by its own prefix, standards and consumer vocabularies alike, without a closed set", () => {
		expect(propertyVocabulary("cred:issuer")).toEqual({ source: "standard", prefix: "cred" });
		expect(propertyVocabulary("prov:generatedAtTime")).toEqual({ source: "standard", prefix: "prov" });
		expect(propertyVocabulary("as:name").source).toBe("standard");
		// a consumer's own sub-vocabulary is NOT haibun's: it is identified by its own prefix, not hardcoded anywhere.
		expect(propertyVocabulary("ex:SomeType")).toEqual({ source: "standard", prefix: "ex" });
		expect(isHaibunTerm("sec:proof")).toBe(false);
	});
});

const catDomain = (persistedAs: string, subClassOf?: string): TRegisteredDomain =>
	({
		topology: { persistedAs, type: `ex:${persistedAs}`, ...(subClassOf ? { subClassOf } : {}), id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
		schema: { parse: (v: unknown) => v },
	}) as unknown as TRegisteredDomain;

describe("category designation, read off the standard subClassOf axioms", () => {
	it("stamps each class with its PROV/SOSA anchor category, defaulting to artifact, and the meta class carries its own", () => {
		const { quads } = ontologyToQuads({ a: catDomain("Party", "prov:Agent"), b: catDomain("Verification", "prov:Activity"), c: catDomain("Record") });
		const cat = (cls: string): unknown => quads.find((q) => q.subject === cls && q.predicate === ONTOLOGY_FIELD.category)?.object;
		expect(cat("Party")).toBe("agent");
		expect(cat("Verification")).toBe("activity");
		expect(cat("Record")).toBe("artifact");
		expect(cat("prov:Agent")).toBe("agent");
		expect(cat("prov:Activity")).toBe("activity");
	});
	it("categoryOf reaches the anchor transitively; an unanchored term is an artifact", () => {
		const supers = new Map([
			["Sub", ["Mid"]],
			["Mid", ["prov:Agent"]],
		]);
		expect(categoryOf("Sub", supers)).toBe("agent");
		expect(categoryOf("Loose", supers)).toBe("artifact");
	});
});
