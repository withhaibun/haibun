import { describe, it, expect } from "vitest";
import { projectDomainChain, SOURCE_DOMAIN, waypointNodeId, factNodeId, type TAffordancesSnapshot } from "./project-domain-chain.js";

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

	it("deep-links every non-source domain node to the affordances panel", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "s", inputDomains: ["a"], outputDomains: ["b"], readyToRun: true }],
			goals: [{ domain: "b", resolution: { finding: "michi" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.link?.href).toBe("?aff-goal=b");
	});

	it("exposes a unique producer via invokes so callers can dispatch directly", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Greeter", stepName: "createGreeting", inputDomains: ["name"], outputDomains: ["greeting"], readyToRun: true }],
			goals: [],
		};
		const g = projectDomainChain(snap);
		const greeting = g.nodes.find((n) => n.id === "greeting");
		expect(greeting?.link?.href).toBe("?aff-goal=greeting");
		expect(greeting?.invokes).toEqual({ stepperName: "Greeter", stepName: "createGreeting" });
	});

	it("does not set invokes on a domain produced by multiple steps (ambiguous), but still deep-links", () => {
		const snap: TAffordancesSnapshot = {
			forward: [
				{ stepperName: "A", stepName: "a", inputDomains: [], outputDomains: ["x"], readyToRun: true },
				{ stepperName: "B", stepName: "b", inputDomains: [], outputDomains: ["x"], readyToRun: true },
			],
			goals: [],
		};
		const g = projectDomainChain(snap);
		const x = g.nodes.find((n) => n.id === "x");
		expect(x?.invokes).toBeUndefined();
		expect(x?.link?.href).toBe("?aff-goal=x");
	});

	it("colors a domain as satisfied when satisfiedDomains contains it, even when goals[] omits it (trivial-filtered)", () => {
		// In live use the affordances panel drops trivial single-step goals from `goals[]`,
		// so a domain that has been asserted (e.g. an issuer the user just created) would
		// be invisible to the chain view if it relied on `goals[]` alone. `satisfiedDomains`
		// is the unfiltered set from working memory; the chain view colours by that.
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Cred", stepName: "createIssuer", inputDomains: [], outputDomains: ["issuer-vertex"], readyToRun: true }],
			goals: [],
			satisfiedDomains: ["issuer-vertex"],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "issuer-vertex")?.kind).toBe("satisfied");
	});

	it("renders fact-instance nodes attached to their satisfied domain", () => {
		// Regression: after creating an issuer, the user expects to see the specific issuer
		// instance (its factId) in the chain, not just the green domain blob.
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Cred", stepName: "createIssuer", inputDomains: [], outputDomains: ["issuer-vertex"], readyToRun: true }],
			goals: [],
			satisfiedDomains: ["issuer-vertex"],
			satisfiedFacts: { "issuer-vertex": ["0.1.3.2"] },
		};
		const g = projectDomainChain(snap);
		const fact = g.nodes.find((n) => n.id === factNodeId("0.1.3.2"));
		expect(fact?.kind).toBe("fact-instance");
		const edge = g.edges.find((e) => e.from === "issuer-vertex" && e.to === factNodeId("0.1.3.2"));
		expect(edge).toBeTruthy();
	});

	it("does NOT bake the selected node into the projection — selection is a UI overlay handled in the view", () => {
		// Regression: prior versions of this projection took `currentDomain` / `currentWaypoint`
		// and replaced the node's kind with "current", losing the base resolver verdict colour.
		// Selection is now a CSS class applied to the rendered SVG by the view; the projection
		// returns the same kinds regardless of which node the user has open.
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "S", stepName: "s", inputDomains: ["a"], outputDomains: ["b"], readyToRun: true }],
			goals: [{ domain: "b", resolution: { finding: "michi" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.kind).toBe("reachable");
		expect(b?.kind).not.toBe("current");
	});

	it("folds waypoints into nodes with ensures edges from their resolvesDomain", () => {
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Cred", stepName: "issue", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
			waypoints: [
				{ outcome: "VC issued", kind: "declarative", method: "ActivitiesStepper-VC issued", resolvesDomain: "vc", ensured: false },
				{ outcome: "Logged in as admin", kind: "imperative", method: "ActivitiesStepper-Logged in as admin", ensured: true },
			],
		};
		const g = projectDomainChain(snap);
		const declarativeId = waypointNodeId("VC issued");
		const imperativeId = waypointNodeId("Logged in as admin");
		const declarative = g.nodes.find((n) => n.id === declarativeId);
		const imperative = g.nodes.find((n) => n.id === imperativeId);
		expect(declarative?.kind).toBe("waypoint-declarative");
		expect(declarative?.link?.href).toBe("?aff-waypoint=VC%20issued");
		expect(declarative?.invokes).toEqual({ stepperName: "ActivitiesStepper", stepName: "VC issued" });
		expect(imperative?.kind).toBe("waypoint-ensured");
		const ensures = g.edges.find((e) => e.from === "vc" && e.to === declarativeId);
		expect(ensures?.label).toBe("ensures");
	});
});
