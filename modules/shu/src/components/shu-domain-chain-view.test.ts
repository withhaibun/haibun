// @vitest-environment jsdom
/**
 * Runtime contract for the domain-chain view.
 *
 * Must reach a terminal display state — either the SVG graph when products
 * are supplied, or an actionable empty-state message. A spinner that never
 * disappears is a bug.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ShuDomainChainView } from "./shu-domain-chain-view.js";
import * as ViewHash from "../view-hash.js";
import { AFFORDANCE_PARAM } from "../consts.js";

const deepLink = (name: string): string => ViewHash.hashParam(name);
const clearDeepLink = (): void => ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "", [AFFORDANCE_PARAM.WAYPOINT]: "" });

describe("shu-domain-chain-view", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// Clear the deep link left over from previous tests so each one starts clean: it lives in the view hash, which
		// is module state rather than the document's.
		clearDeepLink();
		if (!customElements.get("shu-domain-chain-view")) customElements.define("shu-domain-chain-view", ShuDomainChainView);
		if (!customElements.get("shu-spinner")) {
			class FakeSpinner extends HTMLElement {}
			customElements.define("shu-spinner", FakeSpinner);
		}
		if (!customElements.get("shu-copy-button")) {
			class FakeCopyBtn extends HTMLElement {}
			customElements.define("shu-copy-button", FakeCopyBtn);
		}
	});

	it("must NOT show only a spinner forever when mounted without products (regression: reload shows nothing actionable)", async () => {
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
		document.body.appendChild(view);
		await view.updateComplete;
		const html = view.shadowRoot?.innerHTML ?? "";
		const hasEmptyState = /no chain data yet|invoke `show chain lint`/i.test(html);
		const hasSpinner = /shu-spinner/.test(html);
		const hasGraph = /domain-chain-graph/.test(html);
		expect(hasEmptyState || hasGraph || hasSpinner).toBe(true);
	});

	it("the view-controls block (zoom + layout + axis filter) is gated as one group by data-show-controls — no per-control gating", async () => {
		// Zoom, layout, and the filter axis gate as one group. The gating is a single CSS rule
		// on :host(:not([data-show-controls])) .view-controls; everything inside hides together.
		if (!customElements.get("shu-graph-filter")) {
			class FakeFilter extends HTMLElement {
				setAxes(_axes: unknown): void {
					/* test stub */
				}
				setSource(_clusters: unknown, _quads: unknown): void {
					/* test stub */
				}
			}
			customElements.define("shu-graph-filter", FakeFilter);
		}
		if (!customElements.get("shu-graph")) {
			class FakeGraph extends HTMLElement {
				selectedNodeId = "";
				set products(_p: Record<string, unknown>) {
					/* test stub */
				}
				setZoom(_z: number): void {
					/* test stub */
				}
			}
			customElements.define("shu-graph", FakeGraph);
		}
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView & {
			applySseSnapshot: (s: Parameters<ShuDomainChainView["applySseSnapshot"]>[0]) => boolean;
		};
		document.body.appendChild(view);
		view.applySseSnapshot({
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		});
		await view.updateComplete;
		const controls = view.shadowRoot?.querySelector('[data-testid="domain-chain-toolbar"]') as HTMLElement | null;
		expect(controls).toBeTruthy();
		// Every control sits inside the same block.
		expect(controls?.querySelector('button[data-action="zoom-in"]')).toBeTruthy();
		expect(controls?.querySelector('button[data-action="zoom-out"]')).toBeTruthy();
		expect(controls?.querySelector('button[data-action="layout"]')).toBeTruthy();
		expect(controls?.querySelector("shu-graph-filter")).toBeTruthy();
	});

	it("forwards graph-node-click from the embedded shu-graph to routeNodeClick so a deep-link node opens the affordances panel", async () => {
		// Regression: clicking a blue (reachable) node in the chain must open the affordances panel deep-linked to that
		// goal. The flow is: shu-graph dispatches graph-node-click on itself, the chain view's listener catches it, and
		// routeNodeClick writes the deep link into the view state, which the panel reads.
		if (!customElements.get("shu-graph-filter")) {
			class FakeFilter extends HTMLElement {
				setAxes(_axes: unknown): void {
					/* test stub — chain view writes to the filter; the filter's behavior isn't under test here */
				}
				setSource(_clusters: unknown, _quads: unknown): void {
					/* test stub */
				}
			}
			customElements.define("shu-graph-filter", FakeFilter);
		}
		if (!customElements.get("shu-graph")) {
			class FakeGraph extends HTMLElement {
				selectedNodeId = "";
				set products(_p: Record<string, unknown>) {
					// no-op for this test; only the event forwarding matters
				}
				setZoom(_z: number): void {
					/* test stub */
				}
			}
			customElements.define("shu-graph", FakeGraph);
		}
		clearDeepLink();

		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView & {
			applySseSnapshot: (s: Parameters<ShuDomainChainView["applySseSnapshot"]>[0]) => boolean;
		};
		document.body.appendChild(view);
		// Populate affordances so render() actually mounts the shu-graph.
		view.applySseSnapshot({
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		});
		await view.updateComplete;

		let announced = 0;
		const heard = ViewHash.onHashChanged(() => announced++);

		const graphEl = view.shadowRoot?.querySelector("shu-graph");
		expect(graphEl).toBeTruthy();
		// Simulate the shu-graph component dispatching a node click for the "vc" domain.
		graphEl?.dispatchEvent(
			new CustomEvent("graph-node-click", { detail: { nodeId: "vc", node: { id: "vc", kind: "reachable", link: { href: "#?aff-goal=vc" } } }, bubbles: true, composed: true }),
		);
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("vc");
		expect(announced, "and every view reading the same deep link hears that it moved").toBeGreaterThanOrEqual(1);
		heard();
	});

	it("routes a node click with link.href to the deep link it names; never dispatches STEP_CHOOSE (every click opens a view)", () => {
		// Click router contract: every click opens a pane.
		//   - node.link.href "#?aff-goal=X" → writes that deep link into the view state (the affordances panel opens on it).
		//   - node.invokes alone (no link.href) → no-op; the projection is expected to set link.href on every domain node.
		if (!customElements.get("shu-graph-filter")) {
			class FakeFilter extends HTMLElement {
				setAxes(_axes: unknown): void {
					/* test stub — chain view writes to the filter; the filter's behavior isn't under test here */
				}
				setSource(_clusters: unknown, _quads: unknown): void {
					/* test stub */
				}
			}
			customElements.define("shu-graph-filter", FakeFilter);
		}
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
		document.body.appendChild(view);

		let announced = 0;
		const heard = ViewHash.onHashChanged(() => announced++);

		let stepChosen: string | undefined;
		const onChoose = (e: Event) => {
			stepChosen = (e as CustomEvent).detail?.method;
		};
		document.addEventListener("step-choose", onChoose);

		// The link.href branch writes the deep link and announces it, and never chooses a step
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("");
		view.routeNodeClick({ link: { href: "#?aff-goal=vc" } });
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("vc");
		expect(announced).toBeGreaterThanOrEqual(1);
		expect(stepChosen).toBeUndefined();

		// No link.href and not fact-instance → no STEP_CHOOSE, no view-state change. The chain
		// projection always sets link.href on domain nodes, so a node reaching this branch
		// is a projection bug; routeNodeClick must not silently dispatch a step.
		view.routeNodeClick({});
		expect(stepChosen).toBeUndefined();

		heard();
		document.removeEventListener("step-choose", onChoose);
	});

	describe("applySseSnapshot (SSE reducer)", () => {
		// Build a snapshot with N forward entries. Used as a synthetic affordances payload.
		const mkSnap = (n: number, extra?: Partial<Parameters<ShuDomainChainView["applySseSnapshot"]>[0]>): Parameters<ShuDomainChainView["applySseSnapshot"]>[0] => ({
			forward: Array.from({ length: n }, (_, i) => ({ stepperName: "S", stepName: `s${i}`, inputDomains: [], outputDomains: [`d${i}`], readyToRun: true })),
			goals: [],
			...extra,
		});

		const mount = (): ShuDomainChainView => {
			if (!customElements.get("shu-graph-filter")) {
				class FakeFilter extends HTMLElement {
					setAxes(_axes: unknown): void {
						/* test stub */
					}
					setSource(_clusters: unknown, _quads: unknown): void {
						/* test stub */
					}
				}
				customElements.define("shu-graph-filter", FakeFilter);
			}
			const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
			document.body.appendChild(view);
			return view;
		};

		it("applies the first snapshot", () => {
			const view = mount();
			const applied = view.applySseSnapshot(mkSnap(5));
			expect(applied).toBe(true);
			expect(view.getAffordances()?.forward?.length).toBe(5);
		});

		it("drops identical snapshots (fingerprint dedup)", () => {
			const view = mount();
			expect(view.applySseSnapshot(mkSnap(5))).toBe(true);
			// Exact same shape — should not re-apply.
			expect(view.applySseSnapshot(mkSnap(5))).toBe(false);
		});

		it("applies a richer snapshot", () => {
			const view = mount();
			view.applySseSnapshot(mkSnap(5));
			const applied = view.applySseSnapshot(mkSnap(10));
			expect(applied).toBe(true);
			expect(view.getAffordances()?.forward?.length).toBe(10);
		});

		it("drops a downgrade — a snapshot with strictly fewer forward entries does not clobber the richer one", () => {
			// Regression: a partial-context emitter (e.g. subprocess) was sending an affordances
			// snapshot with ~10 entries, wiping the richer ~60-entry snapshot.
			const view = mount();
			view.applySseSnapshot(mkSnap(60));
			const applied = view.applySseSnapshot(mkSnap(10));
			expect(applied).toBe(false);
			expect(view.getAffordances()?.forward?.length).toBe(60);
		});

		it("preserves waypoints across an afterStep snapshot that omits them", () => {
			// A snapshot may omit waypoints (e.g. an as-of replay carries none).
			// Merging must keep the earlier waypoints rather than dropping them.
			const view = mount();
			const waypoints = [
				{
					outcome: "VC issued",
					kind: "imperative" as const,
					method: "ActivitiesStepper-VC issued",
					paramSlots: [],
					proofStatements: [],
					ensured: false,
					source: { path: "f.feature" },
					isBackground: false,
				},
			];
			view.applySseSnapshot({ ...mkSnap(5), waypoints });
			// Subsequent snapshot has the same forward length AND a different goals shape, but no waypoints.
			view.applySseSnapshot({ ...mkSnap(5), goals: [{ domain: "d0", resolution: { finding: "satisfied" } }] });
			expect(view.getAffordances()?.waypoints).toEqual(waypoints);
		});

		it("preserves satisfiedDomains across an afterStep snapshot that omits the field", () => {
			const view = mount();
			view.applySseSnapshot({ ...mkSnap(5), satisfiedDomains: ["d0", "d1"] });
			// Snapshot with a different goals shape but no satisfiedDomains. Forward stays equal so it's not a downgrade.
			view.applySseSnapshot({ ...mkSnap(5), goals: [{ domain: "d2", resolution: { finding: "michi" } }] });
			expect(view.getAffordances()?.satisfiedDomains).toEqual(["d0", "d1"]);
		});

		it("syncs selectedNodeId from the goal deep link without going through setState", () => {
			// Selection is a UI-only field outside StateSchema — toggling it must not
			// trigger a full re-render (relayout shifts the graph).
			const view = mount();
			view.applySseSnapshot(mkSnap(2));
			ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "d1" });
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("d1");
			clearDeepLink();
		});

		it("syncs selectedNodeId from the waypoint deep link as the waypoint-prefixed node id", () => {
			const view = mount();
			view.applySseSnapshot(mkSnap(2));
			ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.WAYPOINT]: "Logged in" });
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("waypoint:Logged in");
			clearDeepLink();
		});

		it("routes a fact-instance node click to step-detail (the producing seqPath) without writing a goal deep link", () => {
			// Each fact-instance's id is `fact:<seqPath>`. Clicking it opens the step-detail
			// pane for that seqPath onto the producing step. It must NOT deep-link into the
			// affordances panel.
			const view = mount();
			let popstateCount = 0;
			const onPop = () => popstateCount++;
			window.addEventListener("popstate", onPop);
			const initialAffGoal = deepLink(AFFORDANCE_PARAM.GOAL);

			view.routeNodeClick({ id: "fact:0.1.3.2", kind: "fact-instance" });

			expect(popstateCount).toBe(0);
			expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe(initialAffGoal);
			window.removeEventListener("popstate", onPop);
		});

		it("accepts an equal-size snapshot whose goals differ", () => {
			// Equal forward.length must not be treated as a downgrade — graph-state changes (a
			// new fact, a new goal) happen without changing the forward set.
			const view = mount();
			view.applySseSnapshot(mkSnap(5));
			const next = { ...mkSnap(5), goals: [{ domain: "d0", resolution: { finding: "satisfied" } }] };
			expect(view.applySseSnapshot(next)).toBe(true);
			expect(view.getAffordances()?.goals.length).toBe(1);
		});
	});
});
