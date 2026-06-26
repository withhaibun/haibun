import { describe, it, expect } from "vitest";
import { ontologyToQuads, ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "./ontology-projection.js";
import { principalDomainDefinition, type TRegisteredDomain } from "@haibun/core/lib/resources.js";

const edge = (quads: ReturnType<typeof ontologyToQuads>["quads"], predicate: string, from: string, to: string): boolean =>
	quads.some((q) => q.predicate === predicate && q.subject === from && q.object === to && q.objectType !== undefined);

describe("ontologyToQuads — the schema rendered as a graph", () => {
	it("emits the directional role hierarchy as subPropertyOf edges (issuer → fromActor → inRoleOf)", () => {
		const { quads, clusters } = ontologyToQuads();
		expect(edge(quads, "subPropertyOf", "issuer", "fromActor")).toBe(true);
		expect(edge(quads, "subPropertyOf", "fromActor", "inRoleOf")).toBe(true);
		expect(edge(quads, "subPropertyOf", "credentialSubject", "toActor")).toBe(true);
		expect(edge(quads, "subPropertyOf", "toActor", "inRoleOf")).toBe(true);
		// the abstract super-properties are nodes in the Property cluster (the interesting structure)
		const props = clusters.find((c) => c.type === ONTOLOGY_PROPERTY);
		for (const rel of ["inRoleOf", "fromActor", "toActor", "issuer", "credentialSubject"]) expect(props?.sampledSubjects).toContain(rel);
	});

	it("flags the abstract super-properties so a view can distinguish them from concrete edge labels", () => {
		const { quads } = ontologyToQuads();
		const abstractOf = (rel: string): boolean => quads.some((q) => q.subject === rel && q.predicate === "abstract" && q.object === true);
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
		expect(edge(quads, "subClassOf", "Principal", "prov:Agent")).toBe(true);
	});

	it("renders the property hierarchy even with no domains (LinkRelations alone)", () => {
		const { clusters } = ontologyToQuads();
		expect(clusters.find((c) => c.type === ONTOLOGY_PROPERTY)?.sampledCount).toBeGreaterThan(10);
		expect(clusters.find((c) => c.type === ONTOLOGY_CLASS)?.sampledCount).toBe(0);
	});
});
