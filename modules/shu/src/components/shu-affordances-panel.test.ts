// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { ShuAffordancesPanel } from "./shu-affordances-panel.js";

/**
 * The panel always reaches a terminal display state — rendering the forward/goals lists when
 * products arrive, or showing a clear "no data yet, trigger X" message when no products have
 * been supplied. A persistent spinner is a defect.
 */

describe("shu-affordances-panel", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// jsdom doesn't ship Element.scrollIntoView — polyfill once so the panel's
		// scroll-once-on-open path runs without throwing.
		if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = (): void => undefined;
		// Clear any aff-goal / aff-waypoint params left by previous tests so the panel's
		// constructor reads a clean URL; otherwise the deep-link state leaks across tests.
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

	it("renders the goals section when products are assigned", () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [{ method: "X-y", stepperName: "X", stepName: "y", inputDomains: [], outputDomains: ["g"], readyToRun: true }],
			goals: [{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-1"] } }],
		};
		const root = panel.shadowRoot?.innerHTML ?? "";
		expect(root).toContain('data-testid="affordances-goals"');
		expect(root).toContain("fact-1");
		expect(root).not.toContain("Loading affordances");
		// The Steps / forward section is gone — the actions-bar step picker
		// surfaces every loaded step with full input / output metadata.
		expect(root).not.toContain('data-testid="affordances-forward"');
	});

	it("renders satisfied goals with every matching fact id (plural)", () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [{ domain: "session", description: "Session", resolution: { finding: "satisfied", goal: "session", factIds: ["s-1", "s-2", "s-3"] } }],
		};
		// The inline fact summary on the closed goal carries the fact ids at a glance.
		const closed = panel.shadowRoot?.innerHTML ?? "";
		expect(closed).toContain("s-1");
		expect(closed).toContain("s-2");
		expect(closed).toContain("s-3");
		// Opening the goal surfaces the resolver's plural "asserted as facts" wording.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-session-toggle"]') as HTMLButtonElement | null)?.click();
		const html = panel.shadowRoot?.innerHTML ?? "";
		expect(html).toMatch(/asserted as facts/);
	});

	it("renders michi findings as a picker with one card per enumerated path", () => {
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
							{
								steps: [{ stepperName: "Issue", stepName: "issueCredential", gwta: "issue credential" }],
								bindings: [{ kind: "argument", domain: "issuer" }],
							},
							{
								steps: [{ stepperName: "Mint", stepName: "mintVc", gwta: "mint a credential" }],
								bindings: [],
							},
						],
					},
				},
			],
		};
		// Goals render closed by default; open the goal to surface its path cards.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		const html = panel.shadowRoot?.innerHTML ?? "";
		expect(html).toMatch(/2 ways to reach this/);
		expect(html).toMatch(/issue credential/);
		expect(html).toMatch(/mint a credential/);
		const startButtons = panel.shadowRoot?.querySelectorAll(".start-path") ?? [];
		expect(startButtons.length).toBe(2);
	});

	it("clicking 'Start this path' opens the path's first step in the actions bar with no auto-dispatch", () => {
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		const path = {
			steps: [{ stepperName: "Issue", stepName: "issueCredential" }],
			bindings: [{ kind: "argument", domain: "issuer" }],
		};
		panel.products = {
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { finding: "michi", goal: "vc", truncated: false, michi: [path] } }],
		};
		type TStepChoose = { method?: string; args?: Record<string, unknown>; auto?: boolean };
		const received: TStepChoose[] = [];
		document.addEventListener("step-choose", ((e: CustomEvent) => {
			received.push(e.detail as TStepChoose);
		}) as EventListener);
		// Open the goal to surface its Start-this-path buttons.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		const startBtn = panel.shadowRoot?.querySelector(".start-path") as HTMLButtonElement;
		startBtn.click();
		const last = received[received.length - 1];
		expect(last?.method).toBe("Issue-issueCredential");
		expect(last?.auto).toBeFalsy();
		expect(last?.args).toBeUndefined();
	});

	it("reports the truncated cap in the path heading when the resolver hit its enumeration limit", () => {
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
						truncated: true,
						michi: [{ steps: [{ stepperName: "Issue", stepName: "issueCredential" }], bindings: [] }],
					},
				},
			],
		};
		// Open the goal to surface the path heading that includes the truncation notice.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		const html = panel.shadowRoot?.innerHTML ?? "";
		expect(html).toMatch(/more exist/);
	});

	it("renders one shu-graph per michi goal and hands it the projected TGraph via products", () => {
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
		// Open the goal to mount its embedded shu-graph.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		const graphEl = panel.shadowRoot?.querySelector('shu-graph[data-testid="goal-graph-0"]') as
			| (HTMLElement & { lastProducts?: { graph?: { nodes: unknown[]; edges: unknown[] } } })
			| null;
		expect(graphEl).toBeTruthy();
		expect(graphEl?.lastProducts?.graph?.nodes?.length).toBeGreaterThan(0);
		expect(graphEl?.lastProducts?.graph?.edges?.length).toBeGreaterThan(0);
	});

	it("re-rendering after a new affordances snapshot preserves <details> open state", () => {
		// Live updates arrive every step end; the view must not lose its place.
		// Opening the "How this panel is computed" details, then receiving a new
		// snapshot, must leave that details still open.
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel & { products: Record<string, unknown> };
		document.body.appendChild(panel);
		panel.products = {
			forward: [],
			goals: [{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-x"] } }],
		};
		const explain = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explain).toBeTruthy();
		if (!explain) throw new Error("unreachable");
		explain.open = true;
		// Simulate a step-end snapshot arriving — a new goal appears.
		panel.products = {
			forward: [],
			goals: [
				{ domain: "g", description: "Goal g", resolution: { finding: "satisfied", goal: "g", factIds: ["fact-x"] } },
				{ domain: "h", description: "Goal h", resolution: { finding: "satisfied", goal: "h", factIds: ["fact-y"] } },
			],
		};
		const explainAfter = panel.shadowRoot?.querySelector('details[data-key="explanation"]') as HTMLDetailsElement | null;
		expect(explainAfter?.open).toBe(true);
		// And the new goal shows up.
		expect(panel.shadowRoot?.innerHTML).toContain("fact-y");
	});

	it("re-rendering preserves open state on a composite-binding tree", () => {
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
		// Open the goal so its composite-binding tree is mounted in the DOM.
		(panel.shadowRoot?.querySelector('button[data-testid="goal-vc-toggle"]') as HTMLButtonElement | null)?.click();
		const composite = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(composite).toBeTruthy();
		if (!composite) throw new Error("unreachable");
		composite.open = true;
		// New affordances snapshot arrives — the composite-binding open state must survive.
		panel.products = {
			forward: [],
			goals: [{ domain: "vc", description: "Verifiable credential", resolution: { finding: "michi", goal: "vc", truncated: false, michi: [compositeMichi] } }],
		};
		const after = panel.shadowRoot?.querySelector<HTMLDetailsElement>('details[data-key="composite:vc"]');
		expect(after?.open).toBe(true);
	});

	it("a satisfied goal that still has producer paths renders BOTH the existing-fact summary AND a Run-again section", () => {
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
		// Closed-by-default: the inline fact summary shows fact ids; the Run-again section
		// lives in the goal's resolution detail and renders once the goal is open.
		const htmlClosed = panel.shadowRoot?.innerHTML ?? "";
		expect(htmlClosed).toContain("fact-1");
		(panel.shadowRoot?.querySelector('button[data-testid="goal-credential-toggle"]') as HTMLButtonElement | null)?.click();
		const html = panel.shadowRoot?.innerHTML ?? "";
		expect(html).toContain("fact-1");
		expect(html).toMatch(/Run again to produce another/);
		const startButtons = panel.shadowRoot?.querySelectorAll(".start-path") ?? [];
		expect(startButtons.length).toBe(1);
	});

	it("must NOT show 'Loading affordances…' forever when mounted without products (regression: reload-without-fetch hangs)", () => {
		// Hash restoration mounts the panel from the URL with no products to thread through.
		// Without a self-fetch path, the panel sat on the spinner indefinitely — a UI dead-end.
		// This test asserts: either the panel fetches its own initial state, or it shows
		// an actionable empty-state message; what it MUST NOT do is show a spinner forever.
		const panel = document.createElement("shu-affordances-panel") as ShuAffordancesPanel;
		document.body.appendChild(panel);
		const root = panel.shadowRoot?.innerHTML ?? "";
		// Either we render an actionable empty state, or we render the (eventually-populated) lists.
		// What we cannot do is show only a spinner with no path forward.
		const hasEmptyState = /no affordances yet|invoke `show affordances`|run a step to see affordances/i.test(root);
		const hasLists = root.includes('data-testid="affordances-forward"');
		expect(hasEmptyState || hasLists).toBe(true);
	});
});
