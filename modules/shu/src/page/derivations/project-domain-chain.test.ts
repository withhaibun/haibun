import { describe, it, expect } from "vitest";
import { SOURCE_DOMAIN } from "@haibun/core/lib/domains/goal-resolution.js";
import { projectDomainChain, waypointNodeId, factNodeId, type TAffordancesSnapshot } from "./project-domain-chain.js";
import { graphToQuads } from "./graph-quads.js";
import { DomainKeySchema } from "@haibun/core/lib/domains/domains.js";

/** A domain's key, as a reader states one. */
const d = (key: string) => DomainKeySchema.parse(key);

describe("projectDomainChain", () => {
	it("maps the proved verdict to the satisfied node kind", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [d("a")], outputDomains: [d("b")], readyToRun: true }],
			goals: [{ domain: d("b"), resolution: { verdict: "proved" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.kind).toBe("satisfied");
	});

	it("maps the unknown verdict, which a plan would prove, to the `reachable` node kind", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [d("a")], outputDomains: [d("b")], readyToRun: false }],
			goals: [{ domain: d("b"), resolution: { verdict: "unknown" } }],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "b")?.kind).toBe("reachable");
	});

	it("introduces the sentinel source domain when any step doesn't have an input domain", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: [d("b")], readyToRun: true }],
			goals: [],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.some((n) => n.id === SOURCE_DOMAIN)).toBe(true);
		const edge = g.edges.find((e) => e.to === "b");
		expect(edge?.from).toBe(SOURCE_DOMAIN);
	});

	it("emits synthetic field nodes and edges from composites map (topology.ranges)", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "issue", inputDomains: [d("order")], outputDomains: [d("fulfilled-order")], readyToRun: true }],
			goals: [],
			composites: { order: { maker: "maker-vertex", proof: "proof" } },
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "order#maker")).toBeTruthy();
		expect(g.nodes.find((n) => n.id === "order#proof")).toBeTruthy();
		expect(g.nodes.find((n) => n.id === "maker-vertex")).toBeTruthy();
		const makerToField = g.edges.find((e) => e.from === "maker-vertex" && e.to === "order#maker");
		const fieldToComposite = g.edges.find((e) => e.from === "order#maker" && e.to === "order");
		expect(makerToField).toBeTruthy();
		expect(fieldToComposite).toBeTruthy();
	});

	it("holds a node for every domain an edge ends at, including a composite that a step doesn't take or return, so the scene draws each edge", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [d("a")], outputDomains: [d("b")], readyToRun: true }],
			goals: [],
			composites: { unnamed: { part: "a" } },
		};
		const g = projectDomainChain(snap);
		const ids = new Set(g.nodes.map((n) => n.id));
		expect(g.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))).toEqual([]);
		expect(() => graphToQuads(g)).not.toThrow();
	});

	it("marks a ready step's edge apart from a blocked one", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [
				{ stepperName: "A", stepName: "a", inputDomains: [d("x")], outputDomains: [d("y")], readyToRun: true },
				{ stepperName: "B", stepName: "b", inputDomains: [d("x")], outputDomains: [d("z")], readyToRun: false },
			],
			goals: [],
		};
		const g = projectDomainChain(snap);
		expect(g.edges.find((e) => e.to === "y")?.kind).toBe("ready");
		expect(g.edges.find((e) => e.to === "z")?.kind).toBe("blocked");
	});

	it("deep-links every non-source domain node to the affordances panel", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [d("a")], outputDomains: [d("b")], readyToRun: true }],
			goals: [{ domain: d("b"), resolution: { verdict: "unknown" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.link?.href).toBe("#?col=shu-affordances-panel&aff-goal=b");
	});

	it("exposes a unique producer via invokes so callers can dispatch directly", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "Greeter", stepName: "createGreeting", inputDomains: [d("name")], outputDomains: [d("greeting")], readyToRun: true }],
			goals: [],
		};
		const g = projectDomainChain(snap);
		const greeting = g.nodes.find((n) => n.id === "greeting");
		expect(greeting?.link?.href).toBe("#?col=shu-affordances-panel&aff-goal=greeting");
		expect(greeting?.invokes).toEqual({ stepperName: "Greeter", stepName: "createGreeting" });
	});

	it("does not set invokes on a domain produced by multiple steps (ambiguous), but still deep-links", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [
				{ stepperName: "A", stepName: "a", inputDomains: [], outputDomains: [d("x")], readyToRun: true },
				{ stepperName: "B", stepName: "b", inputDomains: [], outputDomains: [d("x")], readyToRun: true },
			],
			goals: [],
		};
		const g = projectDomainChain(snap);
		const x = g.nodes.find((n) => n.id === "x");
		expect(x?.invokes).toBeUndefined();
		expect(x?.link?.href).toBe("#?col=shu-affordances-panel&aff-goal=x");
	});

	it("colors a domain as satisfied when satisfiedDomains contains it, even when goals[] omits it (trivial-filtered)", () => {
		// The affordances panel drops trivial single-step goals from `goals[]`, so an
		// asserted domain (e.g. a created issuer) would be invisible to the chain view
		// if it relied on `goals[]` alone. `satisfiedDomains` is the unfiltered set from
		// the facts; the chain view colours by that.
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Cred", stepName: "createIssuer", inputDomains: [], outputDomains: [d("maker-vertex")], readyToRun: true }],
			goals: [],
			satisfiedDomains: [d("maker-vertex")],
		};
		const g = projectDomainChain(snap);
		expect(g.nodes.find((n) => n.id === "maker-vertex")?.kind).toBe("satisfied");
	});

	it("renders fact-instance nodes attached to their satisfied domain", () => {
		// A created issuer surfaces as a specific instance node (its factId) in the
		// chain, not just the green domain blob.
		const snap: TAffordancesSnapshot = {
			forward: [{ stepperName: "Cred", stepName: "createIssuer", inputDomains: [], outputDomains: [d("maker-vertex")], readyToRun: true }],
			goals: [],
			satisfiedDomains: [d("maker-vertex")],
			satisfiedFacts: { "maker-vertex": ["0.1.3.2"] },
		};
		const g = projectDomainChain(snap);
		const fact = g.nodes.find((n) => n.id === factNodeId("0.1.3.2"));
		expect(fact?.kind).toBe("fact-instance");
		const edge = g.edges.find((e) => e.from === "maker-vertex" && e.to === factNodeId("0.1.3.2"));
		expect(edge).toBeTruthy();
	});

	it("does NOT write the selected node into the projection, selection is a UI overlay handled in the view", () => {
		// Selection is a CSS class applied to the rendered SVG by the view, not written
		// into the projection: the projection returns the same kinds regardless of which
		// node is open, preserving each node's base resolver verdict colour.
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [d("a")], outputDomains: [d("b")], readyToRun: true }],
			goals: [{ domain: d("b"), resolution: { verdict: "unknown" } }],
		};
		const g = projectDomainChain(snap);
		const b = g.nodes.find((n) => n.id === "b");
		expect(b?.kind).toBe("reachable");
		expect(b?.kind).not.toBe("current");
	});

	it("merges waypoints into nodes, ensured where their proof holds", () => {
		const snap: TAffordancesSnapshot = {
			satisfiedDomains: [],
			forward: [{ stepperName: "Cred", stepName: "issue", inputDomains: [], outputDomains: [d("vc")], readyToRun: true }],
			goals: [{ domain: d("vc"), resolution: { verdict: "unknown" } }],
			waypoints: [
				{ outcome: "VC issued", method: "ActivitiesStepper-VC issued", ensured: false },
				{ outcome: "Logged in as admin", method: "ActivitiesStepper-Logged in as admin", ensured: true },
			],
		};
		const g = projectDomainChain(snap);
		const pending = g.nodes.find((n) => n.id === waypointNodeId("VC issued"));
		const ensured = g.nodes.find((n) => n.id === waypointNodeId("Logged in as admin"));
		expect(pending?.kind).toBe("waypoint-pending");
		expect(pending?.link?.href).toBe("#?col=shu-affordances-panel&aff-waypoint=VC+issued");
		expect(pending?.invokes).toEqual({ stepperName: "ActivitiesStepper", stepName: "VC issued" });
		expect(ensured?.kind).toBe("waypoint-ensured");
	});
});
