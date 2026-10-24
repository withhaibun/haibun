// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuAffordancesPanel } from "./shu-affordances-panel.js";
import { installConduit } from "../root.js";
import { TestConduit, setupShuTest, type TShuTestHandle } from "../../test/setup.js";
import { installCarriedEventStream } from "../root.js";
import { type TEvent } from "../ports.js";
import * as PageHash from "../controllers/hash-controller.js";
import { AFFORDANCE_PARAM } from "../../domains/elements.js";
import { RPC_METHOD } from "../../domains/elements.js";
import { readingActualityFeature } from "../client-cache/controllers/device-controller.js";
import { declareFakeGraphPresenter, mountedPresenter } from "../../graph-presenter.test-fake.js";
import { presenterIn } from "../controllers/presenter-controller.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import { declareRegistry } from "../../test/catalog-fixture.js";
import { stepsShown } from "../../test/setup.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { SHOW_STEP_DEFINITIONS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { desiredPaneFor } from "./ref-navigation.js";
import { PANE_ATTACH } from "../controllers/pane-controller.js";
import { ShuStepDefinition } from "./shu-step-definition.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { refOf } from "../derivations/markdown.js";

/** The step that reads the affordances on offer, as the show steps step describes it. */
const AFFORDANCES_STEP = {
	method: RPC_METHOD.AFFORDANCES_ON_OFFER,
	stepperName: "LogicStepper",
	stepName: "affordancesOnOffer",
	pattern: "affordances on offer",
	read: true,
	readsAt: Access.public,
};

/** The actuality from which a snapshot records its facts. */
const ACTUALITY_FEATURE = "1790000000000-1";

/** `products` applies synchronously (app.ts coalesces the replay upstream), so just await the lit render. */
const applied = async (panel: { updateComplete: Promise<unknown> }): Promise<void> => {
	await panel.updateComplete;
};

/**
 * The panel always reaches a terminal display state, rendering the forward/goals lists when
 * products arrive, or showing a clear "no data yet, trigger X" message when products haven't
 * been supplied. A persistent spinner is a defect.
 *
 * Tests use `await el.updateComplete` after every mutation because the component is a
 * `LitElement` subclass, `setState` / `products` mutations schedule a microtask-bound
 * update, so synchronous shadowRoot reads would race the render.
 */

describe("shu-affordances-panel", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		document.body.innerHTML = "";
		handle = setupShuTest();
		provideLayout();
		// The view hash holds the deep link, which is module state: clear it the way the app does, or one test's
		// open goal is the next one's starting point.
		PageHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: undefined, [AFFORDANCE_PARAM.WAYPOINT]: undefined });
		if (!customElements.get("shu-spinner")) {
			class FakeSpinner extends HTMLElement {}
			customElements.define("shu-spinner", FakeSpinner);
		}
		if (!customElements.get("shu-copy-button")) {
			class FakeCopyBtn extends HTMLElement {}
			customElements.define("shu-copy-button", FakeCopyBtn);
		}
		declareFakeGraphPresenter({}, []);
	});

	afterEach(() => handle.teardown());

	it("renders the goals section when products are assigned", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [{ method: "X-y", stepperName: "X", stepName: "y", inputDomains: [], outputDomains: ["g"], readyToRun: true }],
			goals: [{ domain: "g", description: "Goal g", resolution: { verdict: "proved", goal: "g", factIds: ["fact-1"], plans: [] } }],
		};
		await applied(panel);
		const root = panel.shadowRoot;
		expect(root?.querySelector('[data-testid="affordances-goals"]')).toBeTruthy();
		expect(root?.querySelector('[data-testid="goal-g-facts"]')?.textContent).toContain("fact-1");
		expect(root?.querySelector("shu-spinner")).toBeNull();
		expect(root?.querySelector('[data-testid="affordances-forward"]')).toBeNull();
	});

	it("renders a proved goal with every fact that proves it", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "session", description: "Session", resolution: { verdict: "proved", goal: "session", factIds: ["s-1", "s-2", "s-3"], plans: [] } }],
		};
		await applied(panel);
		const facts = panel.shadowRoot?.querySelector('[data-testid="goal-session-facts"]')?.textContent ?? "";
		expect(facts).toContain("s-1");
		expect(facts).toContain("s-2");
		expect(facts).toContain("s-3");
		(panel.shadowRoot?.querySelector('button[data-testid="goal-session-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const detail = panel.shadowRoot?.querySelector(".resolution-detail")?.textContent ?? "";
		expect(detail).toContain("already asserted: s-1");
	});

	it("renders an unknown goal's plans as a picker with one card per plan", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [
				{
					domain: "vc",
					description: "Verifiable credential",
					resolution: {
						verdict: "unknown",
						goal: "vc",
						factIds: [],
						plans: [
							{ steps: [{ stepperName: "Issue", stepName: "issueCredential", gwta: "issue credential" }], bindings: [{ kind: "argument", domain: "issuer" }] },
							{ steps: [{ stepperName: "Issue", stepName: "issueVc", gwta: "issue a credential" }], bindings: [] },
						],
					},
				},
			],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const heading = panel.shadowRoot?.querySelector(".path-heading")?.textContent ?? "";
		expect(heading).toContain("2 ways to reach this");
		const stepLabels = Array.from(panel.shadowRoot?.querySelectorAll(".plan-steps li") ?? []).map((li) => li.textContent ?? "");
		expect(stepLabels.some((t) => t.includes("issue credential"))).toBe(true);
		expect(stepLabels.some((t) => t.includes("issue a credential"))).toBe(true);
		expect(panel.shadowRoot?.querySelectorAll(".start-path").length).toBe(2);
	});

	it("links each plan step to the step as actuality declares it, which its pane opens", async () => {
		const ISSUE = { method: "Issue-issueCredential", stepperName: "Issue", stepName: "issueCredential", pattern: "issue credential" };
		handle.teardown();
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEP_DEFINITIONS_METHOD ? stepsShown([ISSUE]) : undefined) });
		const panel = document.body.appendChild(new ShuAffordancesPanel());
		const plan = { steps: [{ stepperName: ISSUE.stepperName, stepName: ISSUE.stepName, gwta: ISSUE.pattern }], bindings: [] };
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { verdict: "unknown", goal: "vc", factIds: [], plans: [plan] } }],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const ref = panel.shadowRoot?.querySelector(".plan-steps li shu-ref");
		const read = refOf(ref?.getAttribute("kind"), JSON.parse(ref?.getAttribute("linkTarget") ?? "{}"));
		const pane = read === undefined ? undefined : desiredPaneFor(read);
		expect(pane).toEqual({ paneType: "step", method: ISSUE.method });
		const attach = PANE_ATTACH.step;
		if (pane?.paneType !== "step" || attach === undefined) throw new Error("a plan step's reference opens a step pane, which the page attaches");
		const view = document.body.appendChild(new ShuStepDefinition());
		await attach(pane, view);
		await view.updateComplete;
		expect(view.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.STEP_DEFINITION.PATTERN}"]`)?.textContent).toBe(ISSUE.pattern);
	});

	it("clicking 'Start this path' opens the path's first step in the actions bar without auto-dispatch", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		const path = { steps: [{ stepperName: "Issue", stepName: "issueCredential" }], bindings: [{ kind: "argument", domain: "issuer" }] };
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { verdict: "unknown", goal: "vc", factIds: [], plans: [path] } }],
		};
		await applied(panel);
		type TStepChoose = { method?: string; args?: Record<string, unknown>; auto?: boolean };
		const received: TStepChoose[] = [];
		document.addEventListener("step-choose", ((e: CustomEvent) => {
			received.push(e.detail as TStepChoose);
		}) as EventListener);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const startBtn = panel.shadowRoot?.querySelector(".start-path") as HTMLButtonElement;
		startBtn.click();
		const last = received[received.length - 1];
		expect(last?.method).toBe("Issue-issueCredential");
		expect(last?.auto).toBeFalsy();
		expect(last?.args).toBeUndefined();
	});

	it("draws an open goal's paths in the site's graph presenter, previews the path a reader points at, and opens a step node in the actions bar", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [
				{
					domain: "vc",
					description: "Verifiable credential",
					resolution: {
						verdict: "unknown",
						goal: "vc",
						factIds: [],
						plans: [{ steps: [{ stepperName: "Issue", stepName: "issueVc", gwta: "issue" }], bindings: [{ kind: "argument", domain: "issuer" }] }],
					},
				},
			],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const presenter = await mountedPresenter(panel, "goal-graph-vc");
		expect(panel.shadowRoot?.querySelector('[data-testid="goal-graph-vc"] slot[name="goal-graph-vc"]'), "shown through the goal's slot").toBeTruthy();
		expect(presenter.dataset.persistScope).toBe("goal-graph");
		const step = "step:Issue.issueVc";
		expect(
			presenter.quads.some((q) => q.subject === step && typeof q.objectType === "string"),
			"the path's step and its edges",
		).toBe(true);

		const card = panel.shadowRoot?.querySelector('[data-testid="path-card-0-0"]') as HTMLElement;
		card.dispatchEvent(new MouseEvent("mouseenter"));
		expect(presenter.previewed).toContain(step);
		card.dispatchEvent(new MouseEvent("mouseleave"));
		expect(presenter.previewed).toBeNull();

		const chosen: string[] = [];
		const onChoose = (e: Event): void => {
			chosen.push((e as CustomEvent<{ method: string }>).detail.method);
		};
		document.addEventListener("step-choose", onChoose);
		presenter.openNode(step);
		document.removeEventListener("step-choose", onChoose);
		expect(chosen).toEqual(["Issue-issueVc"]);

		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		expect(presenterIn(panel, "goal-graph-vc"), "a closed goal's graph goes with it").toBeUndefined();
	});

	it("re-rendering after a new affordances snapshot preserves <details> open state", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "g", description: "Goal g", resolution: { verdict: "proved", goal: "g", factIds: ["fact-x"], plans: [] } }],
		};
		await applied(panel);
		const explain = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explain).toBeTruthy();
		if (!explain) throw new Error("unreachable");
		explain.open = true;
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [
				{ domain: "g", description: "Goal g", resolution: { verdict: "proved", goal: "g", factIds: ["fact-x"], plans: [] } },
				{ domain: "h", description: "Goal h", resolution: { verdict: "proved", goal: "h", factIds: ["fact-y"], plans: [] } },
			],
		};
		await applied(panel);
		const explainAfter = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explainAfter?.open).toBe(true);
		expect(panel.shadowRoot?.innerHTML).toContain("fact-y");
	});

	it("re-rendering preserves open state on a composite-binding tree", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		const compositePlan = {
			steps: [{ stepperName: "Cred", stepName: "issue" }],
			bindings: [
				{
					kind: "composite",
					domain: "vc",
					fields: [
						{ fieldName: "issuer", fieldDomain: "issuer-vertex", fieldType: "object", optional: false, kind: "fact", factId: "fact-1" },
						{ fieldName: "subject", fieldDomain: "", fieldType: "string", optional: false, kind: "argument" },
					],
				},
			],
		};
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { verdict: "unknown", goal: "vc", factIds: [], plans: [compositePlan] } }],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const composite = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(composite).toBeTruthy();
		if (!composite) throw new Error("unreachable");
		composite.open = true;
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { verdict: "unknown", goal: "vc", factIds: [], plans: [compositePlan] } }],
		};
		await applied(panel);
		const after = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(after?.open).toBe(true);
	});

	it("a proved goal that still has plans renders BOTH the existing-fact summary AND a Run-again section", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = {
			actuality: ACTUALITY_FEATURE,
			satisfiedDomains: [],
			forward: [],
			goals: [
				{
					domain: "credential",
					description: "Credential",
					resolution: {
						verdict: "proved",
						goal: "credential",
						factIds: ["fact-1"],
						plans: [{ steps: [{ stepperName: "Issue", stepName: "issueVc", gwta: "issue" }], bindings: [{ kind: "argument", domain: "issuer" }] }],
					},
				},
			],
		};
		await applied(panel);
		expect(panel.shadowRoot?.querySelector('[data-testid="goal-credential-facts"]')?.textContent).toContain("fact-1");
		(panel.shadowRoot?.querySelector('button[data-testid="goal-credential-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		// Once open: the inline fact summary keeps the existing fact id, and the heading on the run-again section uses the proved wording.
		expect(panel.shadowRoot?.querySelector('[data-testid="goal-credential-facts"]')?.textContent).toContain("fact-1");
		expect(panel.shadowRoot?.querySelector(".path-heading")?.textContent).toContain("Run again to produce another");
		expect(panel.shadowRoot?.querySelectorAll(".start-path").length).toBe(1);
	});

	it("must NOT show 'Loading affordances…' forever when mounted without products (regression: reload-without-fetch hangs)", async () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		// The panel's read ends on a later task than its mount.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await applied(panel);
		// Either the actionable empty-state appears, or the panel rendered goals/waypoints lists. The forbidden outcome is only a spinner without a path forward.
		const emptyState = panel.shadowRoot?.querySelector('[data-testid="affordances-empty"]');
		const goalsList = panel.shadowRoot?.querySelector('[data-testid="affordances-goals"]');
		const waypointsList = panel.shadowRoot?.querySelector('[data-testid="affordances-waypoints"]');
		const refusal = panel.shadowRoot?.querySelector("shu-refusal");
		expect(!!emptyState || !!goalsList || !!waypointsList || !!refusal).toBe(true);
	});

	it("waypoints carried by `show affordances` products render the waypoint section: the ONE verb brings the whole snapshot", async () => {
		const wp = { outcome: "deliver-report", kind: "declarative", ensured: false, method: "Acts-ensure", resolvesDomain: "report", paramSlots: [], proofStatements: [] };
		installConduit(new TestConduit(async () => ({})));
		const panel = new ShuAffordancesPanel();
		panel.products = { actuality: ACTUALITY_FEATURE, satisfiedDomains: [], forward: [], goals: [], waypoints: [wp] };
		document.body.appendChild(panel);
		await applied(panel);
		expect(panel.shadowRoot?.querySelector('[data-testid="affordances-waypoints"]')).toBeTruthy();
		expect(panel.shadowRoot?.querySelector('[data-testid="waypoint-deliver-report"]')).toBeTruthy();
	});

	it("a burst of step ends coalesces to ONE snapshot refetch (without a spurious-RPC flood)", async () => {
		// A new subscriber is replayed the whole history, one step end per past step. Refetching per step end is an RPC flood;
		// the panel starts one timer per coalesce window (REFRESH_COALESCE_MS) and the burst rides it, exactly one read.
		let snapshotCalls = 0;
		installConduit(
			new TestConduit((method: string) => {
				if (method === RPC_METHOD.AFFORDANCES_ON_OFFER) snapshotCalls++;
				return { actuality: ACTUALITY_FEATURE, waypoints: [], satisfiedDomains: [], forward: [], goals: [] };
			}),
		);
		declareRegistry(stepsShown([AFFORDANCES_STEP]));
		const stream = installCarriedEventStream();
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel); // subscribes via subscribeBatchedEvents
		await new Promise((r) => setTimeout(r, 40)); // let the mount-time fetchInitial settle, then measure ONLY the burst
		snapshotCalls = 0;
		for (let i = 0; i < 30; i++) stream.emit({ id: `0.${i}`, kind: "lifecycle", type: "step", stage: "end" } as unknown as TEvent); // the whole history, one per past step
		await new Promise((r) => requestAnimationFrame(() => r(undefined))); // drain the rAF batch
		await new Promise((r) => setTimeout(r, 500)); // ride out the coalesce window; the single refetch fires within it
		expect(snapshotCalls).toBe(1);
	});

	it("takes the actuality its snapshot names as the actuality the page reads, where a fact's step opens, and refuses one that doesn't name an actuality", () => {
		const panel = new ShuAffordancesPanel();
		document.body.appendChild(panel);
		panel.products = { actuality: ACTUALITY_FEATURE, satisfiedDomains: [], forward: [], goals: [] };
		expect(readingActualityFeature()).toBe(ACTUALITY_FEATURE);
		expect(() => {
			panel.products = { satisfiedDomains: [], forward: [], goals: [] };
		}).toThrow(/the `actuality` that holds them/);
	});
});
