/**
 * ShuAffordancesPanel — "what can I do next?" view.
 *
 * Subscribes to SSE for artifacts whose payload contains an `affordances` object
 * (emitted by GoalResolutionStepper.afterStep). Renders two sections:
 *   - Forward affordances: steps ready to fire now (greyed when not readyToFire).
 *   - Goal verdicts: per producible domain, the resolver's finding.
 *
 * Click a forward affordance card to invoke its step via the existing RPC machinery.
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
	readyToFire: boolean;
	capability?: string;
};

type TGoalAffordance = {
	domain: string;
	resolution: { finding: "satisfied" | "plan" | "unreachable" | "refused"; [key: string]: unknown };
};

type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
};

export class ShuAffordancesPanel extends HTMLElement {
	private affordances: TAffordances | null = null;
	private invokeError = "";
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
		this.renderComponent();
	}

	private async invokeAffordance(method: string): Promise<void> {
		if (!this.sse) return;
		this.invokeError = "";
		try {
			await inAction(async () => {
				const res = await fetch(`/rpc/${method}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: `affordance-${Date.now()}`, method, params: {} }),
				});
				if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
				const body = (await res.json()) as { error?: { message?: string } };
				if (body?.error) throw new Error(body.error.message ?? "RPC error");
				return body;
			});
		} catch (err) {
			this.invokeError = errorDetail(err);
		}
		this.renderComponent();
	}

	private renderComponent(): void {
		if (!this.shadowRoot) return;
		const styles = SHARED_STYLES;
		const empty = !this.affordances;
		const fwd = this.affordances?.forward ?? [];
		const goals = this.affordances?.goals ?? [];

		const forwardHtml = fwd
			.map((a) => {
				const cls = a.readyToFire ? "affordance ready" : "affordance not-ready";
				const cap = a.capability ? `<span class="cap">cap: ${esc(a.capability)}</span>` : "";
				const inputs = a.inputDomains.length > 0 ? `<span class="domains">in: ${esc(a.inputDomains.join(", "))}</span>` : "";
				const outputs = a.outputDomains.length > 0 ? `<span class="domains">out: ${esc(a.outputDomains.join(", "))}</span>` : "";
				return `<button class="${cls}" data-method="${escAttr(a.method)}" ${a.readyToFire ? "" : "disabled"}>
					<span class="name">${esc(a.gwta ?? a.stepName)}</span>
					${inputs}
					${outputs}
					${cap}
				</button>`;
			})
			.join("");

		const goalsHtml = goals
			.map((g) => {
				const cls = `goal goal-${g.resolution.finding}`;
				return `<div class="${cls}">
					<span class="name">${esc(g.domain)}</span>
					<span class="finding">${esc(g.resolution.finding)}</span>
				</div>`;
			})
			.join("");

		this.shadowRoot.innerHTML = `
			<style>
				${styles}
				:host { display: block; padding: 12px; }
				h3 { margin: 0 0 8px; font-size: 14px; color: #444; }
				.affordance { display: block; width: 100%; text-align: left; padding: 8px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; cursor: pointer; }
				.affordance.ready { border-left: 4px solid #1a6b3c; background: #f0f8f2; }
				.affordance.not-ready { opacity: 0.5; cursor: not-allowed; }
				.affordance:hover.ready { background: #e8f5e9; }
				.affordance .name { display: block; font-weight: 500; color: #222; }
				.affordance .domains { display: inline-block; margin-right: 8px; color: #666; font-size: 11px; font-family: monospace; }
				.affordance .cap { color: #b58105; font-size: 11px; font-family: monospace; }
				.goal { display: flex; justify-content: space-between; padding: 4px 8px; margin: 2px 0; border-radius: 3px; }
				.goal-satisfied { background: #e0f0e8; color: #1a6b3c; }
				.goal-plan { background: #e8edff; color: #2848a8; }
				.goal-unreachable { background: #fdecec; color: #a02828; }
				.goal-refused { background: #fdf3e0; color: #b58105; }
				.goal .name { font-family: monospace; }
				.error { color: #a02828; padding: 8px; background: #fdecec; border-radius: 3px; margin: 4px 0; }
				.empty { color: #888; font-style: italic; }
			</style>
			${this.invokeError ? `<div class="error">${esc(this.invokeError)}</div>` : ""}
			${empty ? '<div class="empty">No affordances yet — run a step to populate.</div>' : ""}
			<h3>Forward (${fwd.length})</h3>
			${forwardHtml || '<div class="empty">No forward affordances.</div>'}
			<h3>Goals (${goals.length})</h3>
			${goalsHtml || '<div class="empty">No goals.</div>'}
		`;

		for (const button of Array.from(this.shadowRoot.querySelectorAll(".affordance.ready"))) {
			button.addEventListener("click", (e) => {
				const target = e.currentTarget as HTMLElement;
				const method = target.dataset.method;
				if (method) void this.invokeAffordance(method);
			});
		}
	}
}
