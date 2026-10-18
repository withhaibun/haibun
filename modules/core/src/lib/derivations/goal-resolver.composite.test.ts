import { describe, it, expect } from "vitest";
import { z } from "zod";
import { resolveGoal, type TBinding, type TResolverInputs } from "./goal-resolver.js";
import { GOAL_FINDING } from "../domains/goal-resolution.js";
import type { TDomainChainGraph } from "./domain-chain.js";
import type { TFact } from "../records/domains/facts.js";
import { Access, type TRegisteredDomain } from "../domains/resources.js";
import { RUN_AUTHORITY } from "../domains/capability-context.js";

/**
 * Tests the resolver's composite decomposition. The resolver recurses into the fields of an input domain that registers
 * `topology.ranges` where `compositeDecomposition` is true. It emits a `kind: "composite"` binding. A fact, an argument
 * or a nested composite satisfies each entry of its `fields[]` independently.
 */

const IssuerSchema = z.object({ did: z.string(), name: z.string().optional() });
const ProofSchema = z.object({ value: z.string() });
const PermitSchema = z.object({
	subject: z.string(),
	issuer: z.string(), // ranged to issuer
	proof: z.object({ value: z.string() }), // ranged to proof
});

function reg(schema: z.ZodType, topology?: TRegisteredDomain["topology"]): TRegisteredDomain {
	return { selectors: [], schema, coerce: (p) => String(p.value), topology, description: "a domain the resolver reads" };
}

function makeDomains(): Record<string, TRegisteredDomain> {
	return {
		issuer: reg(IssuerSchema, { persistedAs: "Issuer", accessLevel: Access.private, id: "did", properties: {} }),
		proof: reg(ProofSchema, { persistedAs: "Proof", accessLevel: Access.private, id: "value", properties: {} }),
		permit: reg(PermitSchema, { persistedAs: "SignedPermit", accessLevel: Access.private, id: "subject", properties: {}, ranges: { issuer: "issuer", proof: "proof" } }),
		"signed-permit": reg(z.object({ id: z.string() })),
	};
}

function graphIssuingPermit(): TDomainChainGraph {
	// One step produces signed-permit from permit. permit doesn't have a producer. The resolver decomposes permit as a
	// composite leaf where composite decomposition is on.
	return {
		domains: [
			{ key: "permit", hasTopology: true },
			{ key: "signed-permit", hasTopology: true },
		],
		steps: [
			{
				stepperName: "Permits",
				stepName: "issuePermit",
				gwta: "issue permit",
				params: { what: "permit" },
				inputDomains: ["permit"],
				outputDomains: ["signed-permit"],
				capability: "Permits:issuePermit",
			},
		],
		edges: [{ from: "permit", to: "signed-permit", stepperName: "Permits", stepName: "issuePermit" }],
	};
}

function withComposite(inputs: TResolverInputs): TResolverInputs {
	return { ...inputs, domains: makeDomains(), compositeDecomposition: true };
}

describe("resolveGoal, composite decomposition", () => {
	it("emits a flat `argument` binding for the composite when decomposition isn't enabled", () => {
		const graph = graphIssuingPermit();
		const result = resolveGoal("signed-permit", { graph, facts: [], held: RUN_AUTHORITY });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const m = result.michi[0];
		expect(m.bindings).toHaveLength(1);
		expect(m.bindings[0]).toMatchObject({ kind: "argument", domain: "permit" });
	});

	it("emits a composite binding with an `argument` field binding for each field without a range", () => {
		const graph = graphIssuingPermit();
		const result = resolveGoal("signed-permit", withComposite({ graph, facts: [], held: RUN_AUTHORITY }));
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const composite = findComposite(result.michi[0].bindings);
		expect(composite).toBeTruthy();
		const subject = composite?.fields.find((f) => f.fieldName === "subject");
		expect(subject).toMatchObject({ kind: "argument", fieldDomain: "" });
	});

	it("binds an existing fact to a ranged field instead of an argument", () => {
		const graph = graphIssuingPermit();
		const issuerFact: TFact = { id: "fact-issuer-1", domain: "issuer", value: { did: "did:example:alice" } };
		const result = resolveGoal("signed-permit", withComposite({ graph, facts: [issuerFact], held: RUN_AUTHORITY }));
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const composite = findComposite(result.michi[0].bindings);
		const issuer = composite?.fields.find((f) => f.fieldName === "issuer");
		expect(issuer).toMatchObject({ kind: "fact", factId: "fact-issuer-1", fieldDomain: "issuer" });
	});

	it("respects compositeMaxDepth: recursion stops at the maximum depth, so the resolver terminates", () => {
		// Self-referential composite: deep.next ranges over deep itself.
		const SelfSchema = z.object({ next: z.string() });
		const domains: Record<string, TRegisteredDomain> = {
			deep: reg(SelfSchema, { persistedAs: "Deep", accessLevel: Access.private, id: "next", properties: {}, ranges: { next: "deep" } }),
			leaf: reg(z.object({ id: z.string() })),
		};
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "deep", hasTopology: true },
				{ key: "leaf", hasTopology: true },
			],
			steps: [{ stepperName: "S", stepName: "f", params: { what: "deep" }, inputDomains: ["deep"], outputDomains: ["leaf"], capability: "S:f" }],
			edges: [{ from: "deep", to: "leaf", stepperName: "S", stepName: "f" }],
		};
		const result = resolveGoal("leaf", { graph, facts: [], held: RUN_AUTHORITY, domains, compositeDecomposition: true, compositeMaxDepth: 2 });
		// The resolver returns a finding without hanging or producing infinite michi.
		expect(result.finding === GOAL_FINDING.MICHI || result.finding === GOAL_FINDING.UNREACHABLE).toBe(true);
	});

	it("emits one michi for a step whose inputs share a domain, not one per edge", () => {
		// Each input of `verify permit {id: string} as {verifierId: string}` has its own graph edge to the products
		// domain. The resolver enumerates the step once, not once per edge, and the michi carries both bindings.
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "string", hasTopology: false },
				{ key: "products", hasTopology: false },
			],
			steps: [
				{
					stepperName: "V",
					stepName: "verify",
					params: { id: "string", verifierId: "string" },
					inputDomains: ["string", "string"],
					outputDomains: ["products"],
					capability: "V:verify",
				},
			],
			edges: [
				{ from: "string", to: "products", stepperName: "V", stepName: "verify" },
				{ from: "string", to: "products", stepperName: "V", stepName: "verify" },
			],
		};
		const result = resolveGoal("products", { graph, facts: [], held: RUN_AUTHORITY });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		expect(result.michi).toHaveLength(1);
		expect(result.michi[0].steps).toHaveLength(1);
		expect(result.michi[0].bindings.length).toBeGreaterThanOrEqual(1);
	});

	it("emits a flat argument binding when the domains map is missing, even with the flag on", () => {
		const graph = graphIssuingPermit();
		const result = resolveGoal("signed-permit", { graph, facts: [], held: RUN_AUTHORITY, compositeDecomposition: true });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		expect(result.michi[0].bindings[0]).toMatchObject({ kind: "argument", domain: "permit" });
	});
});

function findComposite(bindings: TBinding[]) {
	const c = bindings.find((b) => b.kind === "composite");
	return c?.kind === "composite" ? c : null;
}
