import { describe, it, expect } from "vitest";
import { ontologyToQuads, ONTOLOGY_CLASS, ONTOLOGY_PROPERTY, ONTOLOGY_PRED, typesDeclaringRel } from "./ontology-projection.js";
import { LinkRelations, principalDomainDefinition, type TRegisteredDomain } from "@haibun/core/lib/resources.js";

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
});
