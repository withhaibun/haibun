/**
 * ShuAffordancesPanel — "what can I do next?" view, with full explanation.
 *
 * Subscribes to SSE for artifacts whose payload carries an `affordances` object
 * (emitted by GoalResolutionStepper.afterStep). Renders three sections:
 *
 *   1. An explanation of how the panel computes its contents.
 *   2. Forward affordances — steps whose preconditions are currently satisfied.
 *      Each card shows: gwta, input domains (with satisfied/unsatisfied marker),
 *      output domain(s), required capability if any, and the RPC method name.
 *   3. Goal verdicts — per producible domain, the resolver's full finding:
 *      satisfied (shows fact identity), plan (lists the step chain),
 *      unreachable (shows the missing leaf domains), refused (shows the reason).
 *
 * No animation, no auto-magic. Clicking a forward card expands a preview of the
 * RPC call (method + params), then a confirm button invokes it. The user sees
 * what they're committing to before they commit.
 */
import { SHARED_STYLES } from "./styles.js";
import { SseClient, inAction } from "../sse-client.js";
import { esc, escAttr } from "../util.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";

type TForwardAffordance = {
	method: string;
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	readyToRun: boolean;
	capability?: string;
};

type TGoalAffordance = {
	domain: string;
	resolution:
		| { finding: "satisfied"; goal: string; factIdentity: string }
		| {
				finding: "plan";
				goal: string;
				steps: Array<{ stepperName: string; stepName: string; gwta?: string }>;
				assumes: Array<{ domain: string; identity: string }>;
		  }
		| { finding: "unreachable"; goal: string; missing: string[] }
		| { finding: "refused"; goal: string; refusalReason: string; detail: string };
};

type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
};

export class ShuAffordancesPanel extends HTMLElement {
	private affordances: TAffordances | null = null;
	private invokeError = "";
	private invokeStatus = "";
	private expandedMethod: string | null = null;
	private assertedDomains: Set<string> = new Set();
	private unsubscribe: (() => void) | null = null;
	private sse: SseClient | null = null;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		this.sse = SseClient.for("");
		this.unsubscribe = this.sse.onEvent(
			(event) => this.onEvent(event),
			(event) => event.kind === "artifact" && event.artifactType === "json" && !!(event.json as Record<string, unknown>)?.affordances,
		);
		this.renderComponent();
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private onEvent(event: Record<string, unknown>): void {
		const json = event.json as { affordances?: TAffordances } | undefined;
		if (!json?.affordances) return;
		this.affordances = json.affordances;
		// Derive the set of asserted domains from goal verdicts so we can mark
		// individual input domains as satisfied/unsatisfied on forward cards.
		this.assertedDomains = new Set(json.affordances.goals.filter((g) => g.resolution.finding === "satisfied").map((g) => g.domain));
		// Re-broadcast the snapshot for the domain-chain view (and any other
		// listener that wants the same data without duplicating the SSE filter).
		document.dispatchEvent(new CustomEvent("shu:affordances", { detail: json.affordances }));
		this.renderComponent();
	}

	private async invokeAffordance(method: string): Promise<void> {
		if (!this.sse) return;
		this.invokeError = "";
		this.invokeStatus = `Calling ${method}…`;
		this.renderComponent();
		try {
			await inAction(async () => {
				const res = await fetch(`/rpc/${method}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: `affordance-${Date.now()}`, method, params: {} }),
				});
				if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
				const body = (await res.json()) as { error?: { message?: string }; result?: unknown };
				if (body?.error) throw new Error(body.error.message ?? "RPC error");
				return body;
			});
			this.invokeStatus = `${method}: succeeded`;
		} catch (err) {
			this.invokeError = errorDetail(err);
			this.invokeStatus = "";
		}
		this.expandedMethod = null;
		this.renderComponent();
	}

	private toggleExpand(method: string): void {
		this.expandedMethod = this.expandedMethod === method ? null : method;
		this.renderComponent();
	}

	private renderDomainList(domains: string[], showSatisfaction: boolean): string {
		if (domains.length === 0) return '<span class="domain-none">(no inputs)</span>';
		return domains
			.map((d) => {
				if (showSatisfaction) {
					const marker = this.assertedDomains.has(d) ? "✓" : "·";
					const cls = this.assertedDomains.has(d) ? "domain-satisfied" : "domain-pending";
					return `<span class="domain ${cls}"><span class="marker">${marker}</span> ${esc(d)}</span>`;
				}
				return `<span class="domain">${esc(d)}</span>`;
			})
			.join(" ");
	}

	private renderResolution(g: TGoalAffordance): string {
		const r = g.resolution;
		if (r.finding === "satisfied") {
			return `<span class="resolution-detail">already asserted as fact <code>${esc(r.factIdentity)}</code></span>`;
		}
		if (r.finding === "plan") {
			const stepList = r.steps.map((s) => `<li><code>${esc(s.stepperName)}.${esc(s.stepName)}</code>${s.gwta ? ` — ${esc(s.gwta)}` : ""}</li>`).join("");
			const assumesList =
				r.assumes.length > 0 ? `<div class="assumes">assumes facts: ${r.assumes.map((a) => `<code>${esc(a.domain)}#${esc(a.identity)}</code>`).join(", ")}</div>` : "";
			return `<div class="resolution-detail">
				<ol class="plan-steps">${stepList}</ol>
				${assumesList}
			</div>`;
		}
		if (r.finding === "unreachable") {
			return `<span class="resolution-detail">no producer chain. Missing leaves: ${r.missing.map((m) => `<code>${esc(m)}</code>`).join(", ")}</span>`;
		}
		return `<span class="resolution-detail">refused: ${esc(r.refusalReason)} — ${esc(r.detail)}</span>`;
	}

	private renderComponent(): void {
		if (!this.shadowRoot) return;
		const styles = SHARED_STYLES;
		const empty = !this.affordances;
		const fwd = this.affordances?.forward ?? [];
		const goals = this.affordances?.goals ?? [];

		const explanationHtml = `
			<details class="explanation">
				<summary>How this panel is computed</summary>
				<div class="explanation-body">
					<p>This view is a projection over the loaded steppers, registered domains, and the current working memory.</p>
					<ul>
						<li><strong>Forward affordances</strong> are steps whose declared <code>inputDomains</code> are either satisfied by an asserted fact, or supplied as a gwta argument. A check mark beside an input means a fact of that domain exists now.</li>
						<li><strong>Goals</strong> are every domain any loaded step declares as an <code>outputDomain</code>. For each goal the resolver returns one of four findings: satisfied (a fact already exists), plan (a chain of steps can produce it), unreachable (no producer chain reaches it), or refused (the resolver declined to operate — usually a missing capability set).</li>
						<li>Each forward card shows the RPC <code>method</code> name it would call. Clicking expands a preview; the second click confirms and invokes.</li>
					</ul>
				</div>
			</details>
		`;

		const forwardHtml = fwd
			.map((a) => {
				const cls = a.readyToRun ? "affordance ready" : "affordance not-ready";
				const expanded = this.expandedMethod === a.method;
				const cap = a.capability ? `<div class="cap">requires capability: <code>${esc(a.capability)}</code></div>` : "";
				const preview = expanded
					? `<div class="preview">
						<div>RPC method: <code>${esc(a.method)}</code></div>
						<div>Will assert: ${a.outputDomains.length > 0 ? a.outputDomains.map((d) => `<code>${esc(d)}</code>`).join(", ") : "(no products)"}</div>
						<button class="confirm" data-method="${escAttr(a.method)}">Confirm and invoke</button>
					</div>`
					: "";
				return `<div class="${cls}">
					<button class="expander" data-method="${escAttr(a.method)}" ${a.readyToRun ? "" : "disabled"}>
						<div class="name">${esc(a.gwta ?? `${a.stepperName}.${a.stepName}`)}</div>
						<div class="row"><span class="row-label">inputs</span> ${this.renderDomainList(a.inputDomains, true)}</div>
						<div class="row"><span class="row-label">outputs</span> ${this.renderDomainList(a.outputDomains, false)}</div>
						${cap}
					</button>
					${preview}
				</div>`;
			})
			.join("");

		const goalsHtml = goals
			.map((g) => {
				const cls = `goal goal-${g.resolution.finding}`;
				return `<div class="${cls}">
					<div class="goal-header">
						<code class="goal-name">${esc(g.domain)}</code>
						<span class="finding">${esc(g.resolution.finding)}</span>
					</div>
					${this.renderResolution(g)}
				</div>`;
			})
			.join("");

		const status = this.invokeStatus ? `<div class="status">${esc(this.invokeStatus)}</div>` : "";
		const sectionHeader = (title: string, count: number, copyId: string) =>
			`<div class="section-header"><h3>${esc(title)} (${count})</h3><shu-copy-button data-copy-id="${copyId}" label="Copy" title="Copy ${esc(title)} JSON to clipboard"></shu-copy-button></div>`;

		this.shadowRoot.innerHTML = `
			<style>
				${styles}
				:host { display: block; padding: 12px; font-family: inherit; }
				h3 { margin: 0; font-size: 13px; color: #444; }
				.section-header { display: flex; justify-content: space-between; align-items: baseline; margin: 12px 0 6px; }
				.explanation { margin-bottom: 12px; padding: 8px; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 4px; }
				.explanation summary { cursor: pointer; font-size: 12px; color: #555; }
				.explanation-body { padding: 6px 0; font-size: 12px; color: #333; }
				.explanation-body p { margin: 4px 0; }
				.explanation-body ul { margin: 4px 0; padding-left: 16px; }
				.explanation-body code { background: #eee; padding: 0 4px; border-radius: 2px; font-size: 11px; }
				.affordance { border: 1px solid #ddd; border-radius: 4px; margin: 4px 0; overflow: hidden; }
				.affordance.ready { border-left: 4px solid #1a6b3c; }
				.affordance.not-ready { opacity: 0.5; }
				.expander { display: block; width: 100%; text-align: left; padding: 8px 10px; background: #fafafa; border: 0; cursor: pointer; }
				.affordance.ready .expander { background: #f0f8f2; }
				.expander:hover:not(:disabled) { background: #e8f5e9; }
				.expander:disabled { cursor: not-allowed; }
				.name { font-weight: 500; color: #222; margin-bottom: 4px; }
				.row { font-size: 11px; color: #666; margin: 2px 0; font-family: monospace; }
				.row-label { display: inline-block; min-width: 60px; color: #888; }
				.domain { display: inline-block; margin-right: 6px; padding: 1px 4px; background: #eee; border-radius: 2px; }
				.domain-satisfied { background: #d8edd8; color: #1a6b3c; }
				.domain-pending { background: #f5f5f5; color: #666; }
				.domain .marker { font-weight: bold; }
				.domain-none { color: #aaa; font-style: italic; }
				.cap { font-size: 11px; color: #b58105; margin-top: 4px; font-family: monospace; }
				.preview { padding: 8px 10px; background: #fff; border-top: 1px solid #ddd; font-size: 12px; }
				.preview > div { margin: 2px 0; font-family: monospace; }
				.preview code { background: #eee; padding: 0 4px; border-radius: 2px; }
				.confirm { margin-top: 8px; padding: 6px 12px; background: #1a6b3c; color: white; border: 0; border-radius: 3px; cursor: pointer; font-size: 12px; }
				.confirm:hover { background: #155a32; }
				.goal { padding: 8px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; }
				.goal-satisfied { border-left: 4px solid #1a6b3c; }
				.goal-plan { border-left: 4px solid #2848a8; }
				.goal-unreachable { border-left: 4px solid #a02828; }
				.goal-refused { border-left: 4px solid #b58105; }
				.goal-header { display: flex; justify-content: space-between; align-items: center; }
				.goal-name { font-size: 13px; }
				.finding { font-size: 11px; padding: 2px 6px; border-radius: 2px; background: #eee; color: #444; }
				.goal-satisfied .finding { background: #d8edd8; color: #1a6b3c; }
				.goal-plan .finding { background: #d8e1f0; color: #2848a8; }
				.goal-unreachable .finding { background: #fdd; color: #a02828; }
				.goal-refused .finding { background: #fde6c4; color: #b58105; }
				.resolution-detail { display: block; margin-top: 6px; font-size: 12px; color: #333; }
				.resolution-detail code { background: #eee; padding: 0 4px; border-radius: 2px; font-size: 11px; }
				.plan-steps { margin: 4px 0 4px 16px; padding: 0; font-size: 12px; }
				.plan-steps li { margin: 2px 0; }
				.assumes { margin-top: 4px; font-size: 11px; color: #666; }
				.status { padding: 8px; background: #e8edff; color: #2848a8; border-radius: 3px; margin: 4px 0; font-size: 12px; }
				.error { padding: 8px; background: #fdecec; color: #a02828; border-radius: 3px; margin: 4px 0; font-size: 12px; }
				.empty { color: #888; font-style: italic; font-size: 12px; padding: 6px 0; }
			</style>
			${explanationHtml}
			${status}
			${this.invokeError ? `<div class="error">${esc(this.invokeError)}</div>` : ""}
			${empty ? '<div class="empty">No affordances available yet. The first event arrives after the first step runs.</div>' : ""}
			${sectionHeader("Forward affordances", fwd.length, "forward")}
			${forwardHtml || '<div class="empty">No forward affordances.</div>'}
			${sectionHeader("Goals", goals.length, "goals")}
			${goalsHtml || '<div class="empty">No goal-producing steps loaded.</div>'}
		`;

		const fwdCopy = this.shadowRoot.querySelector('shu-copy-button[data-copy-id="forward"]') as (HTMLElement & { source: string }) | null;
		if (fwdCopy) fwdCopy.source = JSON.stringify(fwd, null, 2);
		const goalsCopy = this.shadowRoot.querySelector('shu-copy-button[data-copy-id="goals"]') as (HTMLElement & { source: string }) | null;
		if (goalsCopy) goalsCopy.source = JSON.stringify(goals, null, 2);

		for (const button of Array.from(this.shadowRoot.querySelectorAll(".expander:not(:disabled)"))) {
			button.addEventListener("click", (e) => {
				const target = e.currentTarget as HTMLElement;
				const method = target.dataset.method;
				if (method) this.toggleExpand(method);
			});
		}
		for (const button of Array.from(this.shadowRoot.querySelectorAll(".confirm"))) {
			button.addEventListener("click", (e) => {
				const target = e.currentTarget as HTMLElement;
				const method = target.dataset.method;
				if (method) void this.invokeAffordance(method);
			});
		}
	}
}
