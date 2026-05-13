import { describe, it, expect } from "vitest";
import { z } from "zod";
import { GOAL_FINDING, resolveGoal, type TBinding, type TResolverInputs } from "./goal-resolver.js";
import type { TDomainChainGraph } from "./domain-chain.js";
import type { TQuad } from "./quad-types.js";
import type { TRegisteredDomain } from "./resources.js";

/**
 * Resolver-composite tests.
 *
 * Verify that when `compositeDecomposition: true` is set and an input domain
 * has registered `topology.ranges`, the resolver recurses into its fields and
 * emits a `kind: "composite"` binding whose `fields[]` are independently
 * satisfied (fact, argument, or nested composite).
 */

const IssuerSchema = z.object({ did: z.string(), name: z.string().optional() });
const ProofSchema = z.object({ value: z.string() });
const VcSchema = z.object({
	subject: z.string(),
	issuer: z.string(), // ranged to issuer
	proof: z.object({ value: z.string() }), // ranged to proof
});

function reg(schema: z.ZodType, topology?: TRegisteredDomain["topology"]): TRegisteredDomain {
	return { selectors: [], schema, coerce: (p) => String(p.value), topology };
}

function makeDomains(): Record<string, TRegisteredDomain> {
	return {
		"issuer": reg(IssuerSchema, { vertexLabel: "Issuer", id: "did", properties: {} }),
		"proof": reg(ProofSchema, { vertexLabel: "Proof", id: "value", properties: {} }),
		"vc": reg(VcSchema, {
			vertexLabel: "VerifiableCredential",
			id: "subject",
			properties: {},
			ranges: { issuer: "issuer", proof: "proof" },
		}),
		"verifiable-credential": reg(z.object({ id: z.string() })),
	};
}

function graphIssuingCredential(): TDomainChainGraph {
	// One step that produces verifiable-credential from vc.
	// vc has no producer — it's a composite leaf the resolver should decompose.
	return {
		domains: [
			{ key: "vc", hasTopology: true },
			{ key: "verifiable-credential", hasTopology: true },
		],
		steps: [
			{
				stepperName: "Credentials",
				stepName: "issueCredential",
				gwta: "issue credential",
				inputDomains: ["vc"],
				outputDomains: ["verifiable-credential"],
			},
		],
		edges: [{ from: "vc", to: "verifiable-credential", stepperName: "Credentials", stepName: "issueCredential" }],
	};
}

function withComposite(inputs: TResolverInputs): TResolverInputs {
	return { ...inputs, domains: makeDomains(), compositeDecomposition: true };
}

describe("resolveGoal — composite decomposition", () => {
	it("emits a flat `argument` binding for the composite when decomposition is disabled (back-compat)", () => {
		const graph = graphIssuingCredential();
		const result = resolveGoal("verifiable-credential", { graph, facts: [], capabilities: new Set() });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const m = result.michi[0];
		expect(m.bindings).toHaveLength(1);
		expect(m.bindings[0]).toMatchObject({ kind: "argument", domain: "vc" });
	});

	it("emits a composite binding whose primitive-only fields each become a field-argument", () => {
		const graph = graphIssuingCredential();
		const result = resolveGoal("verifiable-credential", withComposite({ graph, facts: [], capabilities: new Set() }));
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const composite = findComposite(result.michi[0].bindings);
		expect(composite).toBeTruthy();
		const subject = composite?.fields.find((f) => f.fieldName === "subject");
		expect(subject).toMatchObject({ kind: "argument", fieldDomain: "" });
	});

	it("uses an existing fact for a ranged field instead of asking for an argument", () => {
		const graph = graphIssuingCredential();
		const issuerFact: TQuad = {
			subject: "fact-issuer-1",
			predicate: "issuer",
			object: { did: "did:example:alice" },
			namedGraph: "facts",
			timestamp: 1,
		};
		const result = resolveGoal("verifiable-credential", withComposite({ graph, facts: [issuerFact], capabilities: new Set() }));
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		const composite = findComposite(result.michi[0].bindings);
		const issuer = composite?.fields.find((f) => f.fieldName === "issuer");
		expect(issuer).toMatchObject({ kind: "fact", factId: "fact-issuer-1", fieldDomain: "issuer" });
	});

	it("respects compositeMaxDepth — a deep recursion is cut off so the resolver stays bounded", () => {
		// Self-referential composite: deep.next ranges over deep itself.
		const SelfSchema = z.object({ next: z.string() });
		const domains: Record<string, TRegisteredDomain> = {
			deep: reg(SelfSchema, { vertexLabel: "Deep", id: "next", properties: {}, ranges: { next: "deep" } }),
			leaf: reg(z.object({ id: z.string() })),
		};
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "deep", hasTopology: true },
				{ key: "leaf", hasTopology: true },
			],
			steps: [{ stepperName: "S", stepName: "f", inputDomains: ["deep"], outputDomains: ["leaf"] }],
			edges: [{ from: "deep", to: "leaf", stepperName: "S", stepName: "f" }],
		};
		const result = resolveGoal("leaf", { graph, facts: [], capabilities: new Set(), domains, compositeDecomposition: true, compositeMaxDepth: 2 });
		// We just need it to terminate and return some finding without hanging or producing infinite michi.
		expect(result.finding === GOAL_FINDING.MICHI || result.finding === GOAL_FINDING.UNREACHABLE).toBe(true);
	});

	it("emits exactly one michi for a step whose multiple inputs share the same domain (no per-edge duplication)", () => {
		// `verify credential {id: string} as {verifierId: string}`: both inputs land at
		// the products domain via two graph edges. The resolver must enumerate the step
		// once, not once per edge, and the resulting michi must carry both bindings.
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "string", hasTopology: false },
				{ key: "products", hasTopology: false },
			],
			steps: [{ stepperName: "V", stepName: "verify", inputDomains: ["string", "string"], outputDomains: ["products"] }],
			edges: [
				{ from: "string", to: "products", stepperName: "V", stepName: "verify" },
				{ from: "string", to: "products", stepperName: "V", stepName: "verify" },
			],
		};
		const result = resolveGoal("products", { graph, facts: [], capabilities: new Set() });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		expect(result.michi).toHaveLength(1);
		expect(result.michi[0].steps).toHaveLength(1);
		expect(result.michi[0].bindings.length).toBeGreaterThanOrEqual(1);
	});

	it("falls back to flat argument when domains map is missing even though the flag is on", () => {
		const graph = graphIssuingCredential();
		const result = resolveGoal("verifiable-credential", { graph, facts: [], capabilities: new Set(), compositeDecomposition: true });
		if (result.finding !== GOAL_FINDING.MICHI) throw new Error(`expected MICHI, got ${result.finding}`);
		expect(result.michi[0].bindings[0]).toMatchObject({ kind: "argument", domain: "vc" });
	});
});

function findComposite(bindings: TBinding[]) {
	const c = bindings.find((b) => b.kind === "composite");
	return c?.kind === "composite" ? c : null;
}
