// @vitest-environment jsdom
/**
 * Runtime contract for the domain-chain view.
 *
 * Must reach a terminal display state: the chain drawn by the site's graph presenter when products are supplied, or an
 * actionable empty-state message. A spinner that never disappears is a bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShuDomainChainView } from "./shu-domain-chain-view.js";
import * as ViewHash from "../view-hash.js";
import { AFFORDANCE_PARAM, SHU_TAG } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { LINT_FINDING } from "@haibun/core/lib/domain-chain-lint.js";
import { DOMAIN_AFFORDANCES, DOMAIN_STRING } from "@haibun/core/lib/domains.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { readingExecution } from "../client-cache/executions.js";
import { declareFakeGraphPresenter, mountedPresenter } from "../graph-presenter.test-fake.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { NODE_KIND, type TGraphNode } from "../graph/types.js";

/** The actuality a snapshot says its facts are of. */
const EXECUTION = "1790000000000-1";
const GRAPH = SHU_TEST_IDS.DOMAIN_CHAIN.GRAPH;

const deepLink = (name: string): string => ViewHash.hashParam(name);
const clearDeepLink = (): void => ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "", [AFFORDANCE_PARAM.WAYPOINT]: "" });

/** A snapshot with N forward entries, as a step's products or a read of them give it. */
const mkSnap = (n: number): Record<string, unknown> => ({
	execution: EXECUTION,
	forward: Array.from({ length: n }, (_, i) => ({ stepperName: "S", stepName: `s${i}`, inputDomains: [], outputDomains: [`d${i}`], readyToRun: true })),
	goals: [],
});

const mount = (): ShuDomainChainView => {
	const view = new ShuDomainChainView();
	document.body.appendChild(view);
	return view;
};

/** The title the affordances panel's declaration gives its pane. */
const AFFORDANCES_TITLE = "Affordances";

/** A chain node as the projection gives one. */
const chainNode = (node: Partial<TGraphNode> & { id: string }): TGraphNode => ({ label: node.id, ...node });

describe("shu-domain-chain-view", () => {
	let handle: TShuTestHandle;
	afterEach(() => handle.teardown());
	beforeEach(() => {
		document.body.innerHTML = "";
		handle = setupShuTest();
		// Clear the deep link left over from previous tests so each one starts clean: it lives in the view hash, which
		// is module state rather than the document's.
		clearDeepLink();
		// The site declares the affordances panel as core does, titled by its summary.
		declareFakeGraphPresenter({ [DOMAIN_AFFORDANCES]: { component: SHU_TAG.AFFORDANCES_PANEL, summary: AFFORDANCES_TITLE } });
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
	});

	it("must NOT show only a spinner forever when mounted without products (regression: reload doesn't show an actionable message)", async () => {
		const view = mount();
		await view.updateComplete;
		const html = view.shadowRoot?.innerHTML ?? "";
		expect(/no chain data yet/i.test(html) || /shu-spinner/.test(html)).toBe(true);
	});

	it("draws the chain in the site's graph presenter, a light-DOM child shown through its slot, with settings of its own", async () => {
		const view = mount();
		view.products = {
			execution: EXECUTION,
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		};
		await view.updateComplete;
		const presenter = await mountedPresenter(view, GRAPH);
		expect(presenter.parentElement).toBe(view);
		expect(view.shadowRoot?.querySelector(`slot[name="${GRAPH}"]`)).toBeTruthy();
		expect(presenter.hasAttribute("data-external")).toBe(true);
		expect(presenter.dataset.persistScope).toBe("domain-chain");
		expect(presenter.quads.find((q) => q.subject === "vc")?.namedGraph, "a domain is drawn as its verdict").toBe(NODE_KIND.reachable);
		expect(view.summarizeForKihan(), "the chat context reads what the graph shows").toEqual(presenter.summarizeForKihan());
	});

	it("opens the affordances panel at a domain a reader opens in the graph", async () => {
		const view = mount();
		view.products = {
			execution: EXECUTION,
			forward: [{ stepperName: "S", stepName: "s", inputDomains: [], outputDomains: ["vc"], readyToRun: true }],
			goals: [{ domain: "vc", resolution: { finding: "michi" } }],
		};
		await view.updateComplete;
		const presenter = await mountedPresenter(view, GRAPH);
		const opened = vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined);
		let announced = 0;
		const heard = ViewHash.onHashChanged(() => announced++);
		presenter.openNode("vc");
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("vc");
		expect(announced, "and every view reading the same deep link hears that it moved").toBeGreaterThanOrEqual(1);
		expect(opened.mock.calls.map(([, pane]) => pane)).toEqual([{ paneType: "component", tag: SHU_TAG.AFFORDANCES_PANEL, label: AFFORDANCES_TITLE }]);
		// A listener's error is the page's to report, not the dispatcher's to catch.
		const reported: string[] = [];
		const onError = (e: ErrorEvent): void => {
			reported.push(e.message);
			e.preventDefault();
		};
		window.addEventListener("error", onError);
		presenter.openNode("nowhere");
		window.removeEventListener("error", onError);
		expect(reported.join(), "a node the chain does not hold is refused").toMatch(/the chain graph doesn't hold a node "nowhere"/);
		heard();
		opened.mockRestore();
	});

	it("routes a node click with link.href to the deep link it names; never dispatches STEP_CHOOSE (every click opens a view)", () => {
		const view = mount();
		const opened = vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined);
		let stepChosen: string | undefined;
		const onChoose = (e: Event) => {
			stepChosen = (e as CustomEvent).detail?.method;
		};
		document.addEventListener("step-choose", onChoose);
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("");
		view.routeNodeClick(chainNode({ id: "vc", link: { href: "#?col=shu-affordances-panel&aff-goal=vc" } }));
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe("vc");
		expect(stepChosen).toBeUndefined();
		// A node without link.href that isn't fact-instance is a projection bug, refused rather than dispatching a step.
		expect(() => view.routeNodeClick(chainNode({ id: "vc" }))).toThrow("chain node vc doesn't have a deep link to open");
		expect(stepChosen).toBeUndefined();
		document.removeEventListener("step-choose", onChoose);
		opened.mockRestore();
	});

	it("takes the run it names as the run the page reads, where a fact's step opens, and refuses one that doesn't name a run", () => {
		const view = mount();
		view.products = mkSnap(1);
		expect(readingExecution()).toBe(EXECUTION);
		expect(() => {
			view.products = { forward: [], goals: [] };
		}).toThrow(/the `execution` they are of/);
	});

	it("marks the goal or waypoint the address names as the graph's active node", async () => {
		const view = mount();
		view.products = mkSnap(2);
		await view.updateComplete;
		const presenter = await mountedPresenter(view, GRAPH);
		ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "d1" });
		expect(presenter.selected).toBe("d1");
		ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "", [AFFORDANCE_PARAM.WAYPOINT]: "Logged in" });
		expect(presenter.selected, "a waypoint as its waypoint-prefixed node").toBe("waypoint:Logged in");
		clearDeepLink();
		expect(presenter.selected).toBeNull();
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
		view.routeNodeClick(chainNode({ id: "fact:0.1.3.2", kind: NODE_KIND.factInstance, wasGeneratedBy: { factId: "0.1.3.2", domain: "issuer" } }));
		view.routeNodeClick(chainNode({ id: "fact:0.1.4#issuer", kind: NODE_KIND.factInstance, wasGeneratedBy: { factId: "0.1.4#issuer", domain: "issuer" } }));
		expect(opened.mock.calls.map(([, pane]) => pane)).toEqual([
			{ paneType: "step-detail", seqPath: [0, 1, 3, 2] },
			{ paneType: "step-detail", seqPath: [0, 1, 4] },
		]);
		expect(deepLink(AFFORDANCE_PARAM.GOAL)).toBe(initialAffGoal);
		expect(() => view.routeNodeClick(chainNode({ id: "f", kind: NODE_KIND.factInstance, wasGeneratedBy: { factId: "issuer-1", domain: "issuer" } }))).toThrow(
			/doesn't name a step/,
		);
		opened.mockRestore();
	});
});
