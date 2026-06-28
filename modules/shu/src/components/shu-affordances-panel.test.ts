// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuAffordancesPanel } from "./shu-affordances-panel.js";
import { setConduit, resetConduit, SerializedConduit } from "../hypermedia.js";
import { setEventStream, resetEventStream, SerializedEventStream, type TEvent } from "../event-stream.js";

/** `products` applies synchronously (app.ts coalesces the replay upstream), so just await the lit render. */
const applied = async (panel: { updateComplete: Promise<unknown> }): Promise<void> => {
	await panel.updateComplete;
};

/**
 * The panel always reaches a terminal display state — rendering the forward/goals lists when
 * products arrive, or showing a clear "no data yet, trigger X" message when no products have
 * been supplied. A persistent spinner is a defect.
 *
 * Tests use `await el.updateComplete` after every mutation because the component is a
 * `LitElement` subclass — `setState` / `products` mutations schedule a microtask-bound
 * update, so synchronous shadowRoot reads would race the render.
 */

describe("shu-affordances-panel", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = (): void => undefined;
		const url = new URL(window.location.href);
		for (const key of ["aff-goal", "aff-waypoint"]) url.searchParams.delete(key);
		window.history.replaceState(window.history.state, "", url.toString());
		if (!customElements.get("shu-affordances-panel")) customElements.define("shu-affordances-panel", ShuAffordancesPanel);
		if (!customElements.get("shu-spinner")) {
			class FakeSpinner extends HTMLElement {}
			customElements.define("shu-spinner", FakeSpinner);
		}
		if (!customElements.get("shu-copy-button")) {
			class FakeCopyBtn extends HTMLElement {}
			customElements.define("shu-copy-button", FakeCopyBtn);
		}
		if (!customElements.get("shu-graph")) {
			class FakeGraph extends HTMLElement {
				lastProducts: Record<string, unknown> | undefined;
				set products(p: Record<string, unknown>) {
					this.lastProducts = p;
				}
			}
			customElements.define("shu-graph", FakeGraph);
		}
	});

	afterEach(() => {
		resetConduit();
		resetEventStream();
	});

	it("renders the goals section when products are assigned", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [{ method: "X-y", stepperName: "X", stepName: "y", inputDomains: [], outputDomains: ["g"], readyToRun: true }],
			goals: [{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-1"] } }],
		};
		await applied(panel);
		const root = panel.shadowRoot;
		expect(root?.querySelector('[data-testid="affordances-goals"]')).toBeTruthy();
		expect(root?.querySelector('[data-testid="goal-g-facts"]')?.textContent).toContain("fact-1");
		expect(root?.querySelector("shu-spinner")).toBeNull();
		expect(root?.querySelector('[data-testid="affordances-forward"]')).toBeNull();
	});

	it("renders satisfied goals with every matching fact id (plural)", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [{ domain: "session", description: "Session", resolution: { finding: "satisfied", goal: "session", factIds: ["s-1", "s-2", "s-3"] } }],
		};
		await applied(panel);
		const facts = panel.shadowRoot?.querySelector('[data-testid="goal-session-facts"]')?.textContent ?? "";
		expect(facts).toContain("s-1");
		expect(facts).toContain("s-2");
		expect(facts).toContain("s-3");
		(panel.shadowRoot?.querySelector('button[data-testid="goal-session-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const detail = panel.shadowRoot?.querySelector(".resolution-detail")?.textContent ?? "";
		expect(detail).toContain("asserted as facts");
	});

	it("renders michi findings as a picker with one card per enumerated path", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [
				{
					domain: "vc",
					description: "Verifiable credential",
					resolution: {
						finding: "michi",
						goal: "vc",
						truncated: false,
						michi: [
							{ steps: [{ stepperName: "Issue", stepName: "issueCredential", gwta: "issue credential" }], bindings: [{ kind: "argument", domain: "issuer" }] },
							{ steps: [{ stepperName: "Mint", stepName: "mintVc", gwta: "mint a credential" }], bindings: [] },
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
		expect(stepLabels.some((t) => t.includes("mint a credential"))).toBe(true);
		expect(panel.shadowRoot?.querySelectorAll(".start-path").length).toBe(2);
	});

	it("clicking 'Start this path' opens the path's first step in the actions bar with no auto-dispatch", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		const path = { steps: [{ stepperName: "Issue", stepName: "issueCredential" }], bindings: [{ kind: "argument", domain: "issuer" }] };
		panel.products = {
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { finding: "michi", goal: "vc", truncated: false, michi: [path] } }],
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

	it("reports the truncated cap in the path heading when the resolver hit its enumeration limit", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [
				{
					domain: "vc",
					description: "Verifiable credential",
					resolution: { finding: "michi", goal: "vc", truncated: true, michi: [{ steps: [{ stepperName: "Issue", stepName: "issueCredential" }], bindings: [] }] },
				},
			],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		expect(panel.shadowRoot?.querySelector(".path-heading")?.textContent).toContain("more exist");
	});

	it("renders one shu-graph per michi goal and hands it the projected TGraph via products", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [
				{
					domain: "vc",
					description: "Verifiable credential",
					resolution: {
						finding: "michi",
						goal: "vc",
						truncated: false,
						michi: [{ steps: [{ stepperName: "Mint", stepName: "mintVc", gwta: "mint" }], bindings: [{ kind: "argument", domain: "issuer" }] }],
					},
				},
			],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const graphEl = panel.shadowRoot?.querySelector('shu-graph[data-testid="goal-graph-0"]') as
			| (HTMLElement & { lastProducts?: { graph?: { nodes: unknown[]; edges: unknown[] } } })
			| null;
		expect(graphEl).toBeTruthy();
		expect(graphEl?.lastProducts?.graph?.nodes?.length).toBeGreaterThan(0);
		expect(graphEl?.lastProducts?.graph?.edges?.length).toBeGreaterThan(0);
	});

	it("re-rendering after a new affordances snapshot preserves <details> open state", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-x"] } }],
		};
		await applied(panel);
		const explain = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explain).toBeTruthy();
		if (!explain) throw new Error("unreachable");
		explain.open = true;
		panel.products = {
			forward: [],
			goals: [
				{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-x"] } },
				{ domain: "h", description: "Goal h", resolution: { finding: "satisfied", goal: "h", factIds: ["fact-y"] } },
			],
		};
		await applied(panel);
		const explainAfter = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explainAfter?.open).toBe(true);
		expect(panel.shadowRoot?.innerHTML).toContain("fact-y");
	});

	it("re-rendering preserves open state on a composite-binding tree", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		const compositeMichi = {
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
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { finding: "michi", goal: "vc", truncated: false, michi: [compositeMichi] } }],
		};
		await applied(panel);
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		const composite = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(composite).toBeTruthy();
		if (!composite) throw new Error("unreachable");
		composite.open = true;
		panel.products = {
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { finding: "michi", goal: "vc", truncated: false, michi: [compositeMichi] } }],
		};
		await applied(panel);
		const after = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(after?.open).toBe(true);
	});

	it("a satisfied goal that still has producer paths renders BOTH the existing-fact summary AND a Run-again section", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [
				{
					domain: "credential",
					description: "Credential",
					resolution: {
						finding: "satisfied",
						goal: "credential",
						factIds: ["fact-1"],
						michi: [{ steps: [{ stepperName: "Mint", stepName: "mintVc", gwta: "mint" }], bindings: [{ kind: "argument", domain: "issuer" }] }],
						truncated: false,
					},
				},
			],
		};
		await applied(panel);
		expect(panel.shadowRoot?.querySelector('[data-testid="goal-credential-facts"]')?.textContent).toContain("fact-1");
		(panel.shadowRoot?.querySelector('button[data-testid="goal-credential-toggle"]') as HTMLButtonElement | null)?.click();
		await applied(panel);
		// Once open: the inline fact summary keeps the existing fact id, and the heading on the run-again section uses the satisfied wording.
		expect(panel.shadowRoot?.querySelector('[data-testid="goal-credential-facts"]')?.textContent).toContain("fact-1");
		expect(panel.shadowRoot?.querySelector(".path-heading")?.textContent).toContain("Run again to produce another");
		expect(panel.shadowRoot?.querySelectorAll(".start-path").length).toBe(1);
	});

	it("must NOT show 'Loading affordances…' forever when mounted without products (regression: reload-without-fetch hangs)", async () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel;
		document.body.appendChild(panel);
		await applied(panel);
		// Either the actionable empty-state appears, or the panel rendered goals/waypoints lists. The forbidden outcome is only a spinner with no path forward.
		const emptyState = panel.shadowRoot?.querySelector('[data-testid="affordances-empty"]');
		const goalsList = panel.shadowRoot?.querySelector('[data-testid="affordances-goals"]');
		const waypointsList = panel.shadowRoot?.querySelector('[data-testid="affordances-waypoints"]');
		expect(!!emptyState || !!goalsList || !!waypointsList).toBe(true);
	});

	it("loads waypoints from the activities stepper when products arrive without them (affordances view, not only reload)", async () => {
		// `show affordances` produces forward+goals but no waypoints. Setting products before connect mirrors the
		// pane-opener threading products in, which makes onConnected skip the waypoint-preferring fetchInitial — so
		// the waypoint section can only appear via the set-products refresh. Guards the reload-only regression.
		const wp = { outcome: "deliver-report", kind: "declarative", ensured: false, method: "Acts-ensure", resolvesDomain: "report", paramSlots: [], proofStatements: [] };
		setConduit(new SerializedConduit(async (method: string) => (method === "ActivitiesStepper-showWaypoints" ? { waypoints: [wp], forward: [], goals: [] } : {})));
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		panel.products = { forward: [], goals: [] };
		document.body.appendChild(panel);
		await applied(panel);
		await new Promise((r) => setTimeout(r, 0)); // let the fetchWaypoints RPC resolve
		await applied(panel);
		expect(panel.shadowRoot?.querySelector('[data-testid="affordances-waypoints"]')).toBeTruthy();
		expect(panel.shadowRoot?.querySelector('[data-testid="waypoint-deliver-report"]')).toBeTruthy();
	});

	it("the connect-time affordances-event replay coalesces to at most one showWaypoints RPC (no spurious-RPC flood)", async () => {
		// A new subscriber is replayed the whole `affordances.` history (one event per past step). Subscribing per-event
		// would re-fetch ActivitiesStepper-showWaypoints once per replayed step — the spurious-RPC flood (422 each).
		// subscribeBatchedEvents collapses the replay to ONE re-fetch per frame. Pins that as a measurable invariant.
		let waypointsCalls = 0;
		setConduit(
			new SerializedConduit((method: string) => {
				if (method === "ActivitiesStepper-showWaypoints") waypointsCalls++;
				return { waypoints: [], forward: [], goals: [] };
			}),
		);
		const stream = new SerializedEventStream();
		setEventStream(stream);
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel); // subscribes via subscribeBatchedEvents
		await new Promise((r) => setTimeout(r, 40)); // let the mount-time fetchInitial settle, then measure ONLY the replay
		waypointsCalls = 0;
		for (let i = 0; i < 30; i++) stream.emit({ id: `affordances.${i}` } as unknown as TEvent); // the whole history, one per past step
		await new Promise((r) => requestAnimationFrame(() => r(undefined))); // drain the rAF batch
		await new Promise((r) => setTimeout(r, 40)); // let the single fetchInitial + its RPC settle
		expect(waypointsCalls).toBeLessThanOrEqual(1);
	});
});
