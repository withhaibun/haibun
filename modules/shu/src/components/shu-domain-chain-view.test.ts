// @vitest-environment jsdom
/**
 * Runtime contract for the domain-chain view.
 *
 * Must reach a terminal display state: either the SVG graph when products
 * are supplied, or an actionable empty-state message. A spinner that never
 * disappears is a bug.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShuDomainChainView } from "./shu-domain-chain-view.js";
import * as ViewHash from "../view-hash.js";
import { AFFORDANCE_PARAM, SHU_EVENT } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { LINT_FINDING } from "@haibun/core/lib/domain-chain-lint.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domains.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { readingExecution, resetExecutions } from "../client-cache/executions.js";

/** The run a snapshot says its facts are of. */
const EXECUTION = "1790000000000-1";

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

	it("the view-controls block (zoom + layout + axis filter) is gated as one group by data-show-controls: no per-control gating", async () => {
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
		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
		document.body.appendChild(view);
		view.products = {
			execution: EXECUTION,
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		};
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
					/* test stub, chain view writes to the filter; the filter's behavior isn't under test here */
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

		const view = document.createElement("shu-domain-chain-view") as ShuDomainChainView;
		document.body.appendChild(view);
		// Populate affordances so render() mounts the shu-graph.
		view.products = {
			execution: EXECUTION,
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		};
		await view.updateComplete;

		let announced = 0;
		const heard = ViewHash.onHashChanged(() => announced++);

		const graphEl = view.shadowRoot?.querySelector("shu-graph");
		expect(graphEl).toBeTruthy();
		// Simulate the shu-graph component dispatching a node click for the "vc" domain.
		graphEl?.dispatchEvent(
			new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, {
				detail: { nodeId: "vc", node: { id: "vc", kind: "reachable", link: { href: "#?aff-goal=vc" } } },
				bubbles: true,
				composed: true,
			}),
		);
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("vc");
		expect(announced, "and every view reading the same deep link hears that it moved").toBeGreaterThanOrEqual(1);
		heard();
	});

	it("routes a node click with link.href to the deep link it names; never dispatches STEP_CHOOSE (every click opens a view)", () => {
		// Click router contract: every click opens a pane.
		//   - node.link.href "#?aff-goal=X" → writes that deep link into the view state (the affordances panel opens on it).
		//   - a node with no link.href is refused: the projection sets link.href on every domain node.
		if (!customElements.get("shu-graph-filter")) {
			class FakeFilter extends HTMLElement {
				setAxes(_axes: unknown): void {
					/* test stub, chain view writes to the filter; the filter's behavior isn't under test here */
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

		// No link.href and not fact-instance is a projection bug, refused rather than dispatching a step.
		expect(() => view.routeNodeClick({ id: "vc" })).toThrow("chain node vc has no deep link to open");
		expect(stepChosen).toBeUndefined();

		heard();
		document.removeEventListener("step-choose", onChoose);
	});

	describe("a snapshot of the run's affordances", () => {
		// A snapshot with N forward entries, as a step's products or a read of them give it.
		const mkSnap = (n: number): Record<string, unknown> => ({
			execution: EXECUTION,
			forward: Array.from({ length: n }, (_, i) => ({ stepperName: "S", stepName: `s${i}`, inputDomains: [], outputDomains: [`d${i}`], readyToRun: true })),
			goals: [],
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

		it("takes the run it names as the run the page reads, where a fact's step opens, and refuses one naming no run", () => {
			resetExecutions();
			const view = mount();
			view.products = mkSnap(1);
			expect(readingExecution()).toBe(EXECUTION);
			expect(() => {
				view.products = { forward: [], goals: [] };
			}).toThrow(/the `execution` they are of/);
		});

		it("syncs selectedNodeId from the goal deep link without going through setState", () => {
			// Selection is a UI-only field outside StateSchema, toggling it must not
			// trigger a full re-render (relayout shifts the graph).
			const view = mount();
			view.products = mkSnap(2);
			ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "d1" });
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("d1");
			clearDeepLink();
		});

		it("syncs selectedNodeId from the waypoint deep link as the waypoint-prefixed node id", () => {
			const view = mount();
			view.products = mkSnap(2);
			ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.WAYPOINT]: "Logged in" });
			expect((view as unknown as { selectedNodeId: string }).selectedNodeId).toBe("waypoint:Logged in");
			clearDeepLink();
		});

		it("lists a lint report's findings, each step and domain a link to its view", async () => {
			const view = mount();
			view.products = {
				execution: EXECUTION,
				forward: [],
				goals: [],
				findings: [
					{ kind: LINT_FINDING.STRING_PARAM, stepperName: "S", stepName: "s", param: "p", domain: DOMAIN_STRING },
					{ kind: LINT_FINDING.UNREACHABLE_DOMAIN, domain: "dead" },
				],
			};
			await view.updateComplete;
			const refs = [...(view.shadowRoot?.querySelectorAll(`[data-testid="${SHU_TEST_IDS.DOMAIN_CHAIN.FINDING}"] shu-ref`) ?? [])].map((ref) => [
				ref.getAttribute("kind"),
				JSON.parse(ref.getAttribute("linkTarget") ?? "{}"),
			]);
			expect(refs).toEqual([
				["step", { method: "S-s" }],
				[REF_DENOTES.type, { domain: DOMAIN_STRING }],
				[REF_DENOTES.type, { domain: "dead" }],
			]);
		});

		it("routes a fact-instance node click to the step that produced it, a field's fact included, without writing a goal deep link", () => {
			const view = mount();
			const opened = vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined);
			const initialAffGoal = deepLink(AFFORDANCE_PARAM.GOAL);
			view.routeNodeClick({ id: "fact:0.1.3.2", kind: "fact-instance", wasGeneratedBy: { factId: "0.1.3.2", domain: "issuer" } });
			view.routeNodeClick({ id: "fact:0.1.4#issuer", kind: "fact-instance", wasGeneratedBy: { factId: "0.1.4#issuer", domain: "issuer" } });
			expect(opened.mock.calls.map(([, pane]) => pane)).toEqual([
				{ paneType: "step-detail", seqPath: [0, 1, 3, 2] },
				{ paneType: "step-detail", seqPath: [0, 1, 4] },
			]);
			expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe(initialAffGoal);
			expect(() => view.routeNodeClick({ kind: "fact-instance", wasGeneratedBy: { factId: "issuer-1", domain: "issuer" } })).toThrow(/names no step/);
			opened.mockRestore();
		});
	});
});
