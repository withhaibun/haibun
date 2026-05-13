import { describe, it, expect } from "vitest";
import { projectDomainChain, SOURCE_DOMAIN, type TAffordancesSnapshot } from "./project-domain-chain.js";

describe("projectDomainChain", () => {
	it("maps the satisfied finding to the satisfied node kind", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "s", inputDomains: ["a"], outputDomains: ["b"], readyToRun: true }],
			goals: [{ domain: "b", resolution: { finding: "satisfied" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.kind).toBe("satisfied");
	});

	it("maps the resolver's `michi` finding to the user-facing `reachable` node kind", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "s", inputDomains: ["a"], outputDomains: ["b"], readyToRun: false }],
			goals: [{ domain: "b", resolution: { finding: "michi" } }],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "b")?.kind).toBe("reachable");
	});

	it("introduces the sentinel source domain when any step has no input domains", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["b"], readyToRun: true }],
			goals: [],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.some((n) => n.id === SOURCE_DOMAIN)).toBe(true);
		const edge = g.edges.find((e) => e.to === "b");
		expect(edge?.from).toBe(SOURCE_DOMAIN);
	});

	it("emits synthetic field nodes and edges from composites map (topology.ranges)", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "issue", inputDomains: ["vc"], outputDomains: ["verifiable-credential"], readyToRun: true }],
			goals: [],
			composites: { vc: { issuer: "issuer-vertex", proof: "proof" } },
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "vc#issuer")).toBeTruthy();
		expect(g.nodes.find((n) => n.id === "vc#proof")).toBeTruthy();
		expect(g.nodes.find((n) => n.id === "issuer-vertex")).toBeTruthy();
		const issuerToField = g.edges.find((e) => e.from === "issuer-vertex" && e.to === "vc#issuer");
		const fieldToComposite = g.edges.find((e) => e.from === "vc#issuer" && e.to === "vc");
		expect(issuerToField).toBeTruthy();
		expect(fieldToComposite).toBeTruthy();
	});

	it("flags capability-gated edges separately from ready / blocked", () => {
		const snap: TAffordancesSnapshot = {
			forward: [
				{ stepperName: "A", stepName: "a", inputDomains: ["x"], outputDomains: ["y"], readyToRun: true },
				{ stepperName: "B", stepName: "b", inputDomains: ["x"], outputDomains: ["z"], readyToRun: false },
				{ stepperName: "C", stepName: "c", inputDomains: ["x"], outputDomains: ["w"], readyToRun: false, capability: "auth:signin" },
			],
			goals: [],
		};
		const g = projectDomainChain(snap);
		const a = g.edges.find((e) => e.to === "y");
		const b = g.edges.find((e) => e.to === "z");
		const c = g.edges.find((e) => e.to === "w");
		expect(a?.kind).toBe("ready");
		expect(b?.kind).toBe("blocked");
		expect(c?.kind).toBe("capability-gated");
	});
});
