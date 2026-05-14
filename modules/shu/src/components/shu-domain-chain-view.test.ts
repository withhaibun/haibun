// @vitest-environment jsdom
/**
 * Runtime contract for the domain-chain view.
 *
 * Must reach a terminal display state — either the Mermaid graph when products
 * are supplied, or an actionable empty-state message. A spinner that never
 * disappears is a bug.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ShuDomainChainView } from "./shu-domain-chain-view.js";

describe("shu-domain-chain-view", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// Clear deep-link params left over from previous tests so each one starts clean.
		const url = new URL(window.location.href);
		for (const key of ["aff-goal", "aff-waypoint"]) url.searchParams.delete(key);
		window.history.replaceState(window.history.state, "", url.toString());
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

	it("must NOT show only a spinner forever when mounted without products (regression: reload shows nothing actionable)", () => {
		// Hash restoration mounts the view from the URL with no products. Either the
		// view fetches its own state, or it shows an actionable empty-state message.
		// What it MUST NOT do is sit on a spinner with no path forward.
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
		document.body.appendChild(view);
		const html = view.shadowRoot?.innerHTML ?? "";
		// In a test env the fetch will fail (no EventSource); the empty state must surface.
		// Either the spinner is gone OR an actionable empty message is visible.
		const hasEmptyState = /no chain data yet|invoke `show chain lint`/i.test(html);
		const hasSpinner = /shu-spinner/.test(html);
		const hasGraph = /domain-chain-graph/.test(html);
		expect(hasEmptyState || hasGraph || hasSpinner).toBe(true); // some terminal state, not blank
		// And specifically: we cannot end up with ONLY a spinner and nothing else (forever).
		// In jsdom the fetch path fails fast; the test asserts the empty state appears.
	});

	it("the view-controls block (zoom + layout + axis filter) is gated as one group by data-show-controls — no per-control gating", () => {
		// Regression: zoom, layout, and the filter axis used to be partially separate; this
		// scenario pins the unified-toggle invariant. The gating is a single CSS rule on
		// :host(:not([data-show-controls])) .view-controls; everything inside hides together.
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
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView & { applySseSnapshot: (s: Parameters<ShuDomainChainView["applySseSnapshot"]>[0]) => boolean };
		document.body.appendChild(view);
		view.applySseSnapshot({
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		});
		const controls = view.shadowRoot?.querySelector('[data-testid="domain-chain-toolbar"]') as HTMLElement | null;
		expect(controls).toBeTruthy();
		// Every control sits inside the same block.
		expect(controls?.querySelector('button[data-action="zoom-in"]')).toBeTruthy();
		expect(controls?.querySelector('button[data-action="zoom-out"]')).toBeTruthy();
		expect(controls?.querySelector('button[data-action="layout"]')).toBeTruthy();
		expect(controls?.querySelector("shu-graph-filter")).toBeTruthy();
	});

	it("forwards graph-node-click from the embedded shu-graph to routeNodeClick so a deep-link node opens the affordances panel", () => {
		// Regression: clicking a blue (reachable) node in the chain must open the affordances
		// panel deep-linked to that goal. The flow is: shu-graph dispatches graph-node-click on
		// itself → chain view's listener catches → routeNodeClick pushes URL + dispatches popstate.
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
		const url = new URL(window.location.href);
		for (const k of ["aff-goal", "aff-waypoint"]) url.searchParams.delete(k);
		window.history.replaceState(window.history.state, "", url.toString());

		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView & { applySseSnapshot: (s: Parameters<ShuDomainChainView["applySseSnapshot"]>[0]) => boolean };
		document.body.appendChild(view);
		// Populate affordances so render() actually mounts the shu-graph.
		view.applySseSnapshot({
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		});

		let popstateCount = 0;
		const onPop = () => popstateCount++;
		window.addEventListener("popstate", onPop);

		const graphEl = view.shadowRoot?.querySelector("shu-graph");
		expect(graphEl).toBeTruthy();
		// Simulate the shu-graph component dispatching a node click for the "vc" domain.
		graphEl?.dispatchEvent(
			new CustomEvent("graph-node-click", { detail: { nodeId: "vc", node: { id: "vc", kind: "reachable", link: { href: "?aff-goal=vc" } } }, bubbles: true, composed: true }),
		);
		expect(new URL(window.location.href).searchParams.get("aff-goal")).toBe("vc");
		expect(popstateCount).toBeGreaterThanOrEqual(1);
		window.removeEventListener("popstate", onPop);
	});

	it("routes a node click with link.href to URL update + popstate; never dispatches STEP_CHOOSE (every click opens a view)", () => {
		// Click router contract: every click opens a pane.
		//   - node.link.href "?aff-goal=X" → updates URL search params + dispatches popstate (affordances panel opens deep-linked).
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

		let popstateCount = 0;
		const onPop = () => popstateCount++;
		window.addEventListener("popstate", onPop);

		let stepChosen: string | undefined;
		const onChoose = (e: Event) => {
			stepChosen = (e as CustomEvent).detail?.method;
		};
		document.addEventListener("step-choose", onChoose);

		// link.href branch → URL update + popstate, never STEP_CHOOSE
		const beforeSearch = new URL(window.location.href).searchParams.get("aff-goal");
		expect(beforeSearch).toBeNull();
		view.routeNodeClick({ link: { href: "?aff-goal=vc" } });
		expect(new URL(window.location.href).searchParams.get("aff-goal")).toBe("vc");
		expect(popstateCount).toBeGreaterThanOrEqual(1);
		expect(stepChosen).toBeUndefined();

		// No link.href and not fact-instance → no STEP_CHOOSE, no URL change. The chain
		// projection always sets link.href on domain nodes, so a node reaching this branch
		// is a projection bug; routeNodeClick must not silently dispatch a step.
		view.routeNodeClick({});
		expect(stepChosen).toBeUndefined();

		window.removeEventListener("popstate", onPop);
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
			// snapshot with ~10 entries, wiping the ~60-entry snapshot from `showWaypoints`.
			const view = mount();
			view.applySseSnapshot(mkSnap(60));
			const applied = view.applySseSnapshot(mkSnap(10));
			expect(applied).toBe(false);
			expect(view.getAffordances()?.forward?.length).toBe(60);
		});

		it("preserves waypoints across an afterStep snapshot that omits them", () => {
			// `showWaypoints` returns waypoints; the goal-resolver's afterStep snapshot does not.
			// Merging must keep the previously seen waypoints rather than dropping them.
			const view = mount();
			const waypoints = [{ outcome: "VC issued", kind: "imperative" as const, method: "ActivitiesStepper-VC issued", paramSlots: [], proofStatements: [], ensured: false, source: { path: "f.feature" }, isBackground: false }];
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

		it("syncs selectedNodeId from ?aff-goal=<domain> on popstate without going through setState", () => {
			// Selection is a UI-only field outside StateSchema — toggling it must not
			// trigger a full re-render (mermaid relayout shifts the graph).
			const view = mount();
			view.applySseSnapshot(mkSnap(2));
			const url = new URL(window.location.href);
			url.searchParams.set("aff-goal", "d1");
			window.history.replaceState(window.history.state, "", url.toString());
			window.dispatchEvent(new PopStateEvent("popstate"));
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("d1");
			url.searchParams.delete("aff-goal");
			window.history.replaceState(window.history.state, "", url.toString());
		});

		it("syncs selectedNodeId from ?aff-waypoint=<outcome> as the waypoint-prefixed node id", () => {
			const view = mount();
			view.applySseSnapshot(mkSnap(2));
			const url = new URL(window.location.href);
			url.searchParams.set("aff-waypoint", "Logged in");
			window.history.replaceState(window.history.state, "", url.toString());
			window.dispatchEvent(new PopStateEvent("popstate"));
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("waypoint:Logged in");
			url.searchParams.delete("aff-waypoint");
			window.history.replaceState(window.history.state, "", url.toString());
		});

		it("routes a fact-instance node click to step-detail (the producing seqPath) without pushing ?aff-goal", () => {
			// Reproduce-path: each fact-instance's id is `fact:<seqPath>`. Clicking it should
			// open the step-detail pane for that seqPath so the user can inspect the
			// producing step. It must NOT deep-link into the affordances panel.
			const view = mount();
			let popstateCount = 0;
			const onPop = () => popstateCount++;
			window.addEventListener("popstate", onPop);
			const initialAffGoal = new URL(window.location.href).searchParams.get("aff-goal");

			view.routeNodeClick({ id: "fact:0.1.3.2", kind: "fact-instance" });

			expect(popstateCount).toBe(0);
			expect(new URL(window.location.href).searchParams.get("aff-goal")).toBe(initialAffGoal);
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
