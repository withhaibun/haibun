/**
 * ShuAffordancesPanel — list of runnable steps and per-goal verdicts.
 *
 * Clicking a step hands the method to the actions-bar step input via STEP_CHOOSE —
 * the same flow used when the user picks a step from the combo. The panel never
 * invokes RPCs itself; the step-caller in the actions-bar runs the step.
 */
import { z } from "zod";
import { SHARED_STYLES } from "./styles.js";
import { SseClient, inAction } from "../sse-client.js";
import { esc, escAttr } from "../util.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { GOAL_FINDING, type TMichi, type TBinding, type TFieldBinding } from "@haibun/core/lib/goal-resolver.js";
import { isArgumentDomain } from "@haibun/core/lib/affordances.js";
import { stepMethodName } from "@haibun/core/lib/step-dispatch.js";
import { SHU_EVENT } from "../consts.js";
import { pathId, projectGoalPaths } from "../graph/project-goal-paths.js";
import { factIdRef } from "./shu-ref.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";
import type { TGraph } from "../graph/types.js";
import { ShuElement } from "./shu-element.js";

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
	description: string;
	resolution:
	| { finding: "satisfied"; goal: string; factIds: string[]; michi: TMichi[]; truncated: boolean }
	| { finding: "michi"; goal: string; michi: TMichi[]; truncated: boolean }
	| { finding: "unreachable"; goal: string; missing: string[] }
	| { finding: "refused"; goal: string; refusalReason: string; detail: string };
};

type TWaypointEntry = {
	outcome: string;
	kind: "imperative" | "declarative";
	method: string;
	paramSlots: string[];
	proofStatements: string[];
	resolvesDomain?: string;
	currentlyValid: boolean;
	error?: string;
	source: { path: string; lineNumber?: number };
	isBackground: boolean;
};

type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
	waypoints?: TWaypointEntry[];
};

/** Human-readable label for a resolver finding. */
function findingLabel(finding: string): string {
	if (finding === GOAL_FINDING.MICHI) return "reachable";
	return finding;
}


const ShuAffordancesPanelSchema = z.object({
	loadState: z.enum(["idle", "fetching", "loaded", "empty"]).default("idle"),
	fetchError: z.string().default(""),
	openGoal: z.string().default(""),
});

const AFF_GOAL_PARAM = "aff-goal";

function readOpenGoalFromUrl(): string {
	if (typeof window === "undefined") return "";
	try {
		return new URL(window.location.href).searchParams.get(AFF_GOAL_PARAM) ?? "";
	} catch {
		return "";
	}
}

function writeOpenGoalToUrl(domain: string): void {
	if (typeof window === "undefined") return;
	const url = new URL(window.location.href);
	if (domain) url.searchParams.set(AFF_GOAL_PARAM, domain);
	else url.searchParams.delete(AFF_GOAL_PARAM);
	window.history.replaceState(window.history.state, "", url.toString());
}

export class ShuAffordancesPanel extends ShuElement<typeof ShuAffordancesPanelSchema> {
	private affordances: TAffordances | null = null;
	private assertedDomains: Set<string> = new Set();
	private lastScrolledGoal: string = "";
	private sse: SseClient | null = null;
	private unsubscribe: (() => void) | null = null;

	private popstateHandler: (() => void) | null = null;

	constructor() {
		super(ShuAffordancesPanelSchema, { loadState: "idle", fetchError: "", openGoal: readOpenGoalFromUrl() });
	}

	override connectedCallback(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", "shu-affordances");
		// SSE client may be absent in test envs (jsdom has no EventSource) — keep it optional.
		try {
			this.sse = SseClient.for("");
		} catch {
			this.sse = null;
		}
		super.connectedCallback();
		// Hash restoration mounts the panel without products. Fetch the current snapshot
		// directly so the user sees real data instead of a forever-spinner. The setter
		// path still wins when products are threaded through (step invocation).
		if (this.affordances === null && this.sse) void this.fetchInitial();
		// Live updates: every step end emits an `affordances.<seqPath>` artifact
		// via the goal-resolution stepper's afterStep cycle. Subscribing keeps the
		// panel current as the user runs steps; ShuElement's snapshot/restore
		// preserves scroll, focus, and details-open state across re-renders.
		if (this.sse) {
			this.unsubscribe = this.sse.onEvent(
				(event) => {
					const body = event.json as { affordances?: TAffordances } | undefined;
					if (!body?.affordances) return;
					this.applyAffordances(body.affordances);
				},
				(event) => typeof event.id === "string" && event.id.startsWith("affordances."),
			);
		}
		// Back/forward navigation should re-sync the open goal from the URL so the
		// panel reflects the address bar. Storing in history rather than state means
		// a copy-pasted URL also opens the right goal on first load.
		this.popstateHandler = () => {
			const fromUrl = readOpenGoalFromUrl();
			if (fromUrl !== this.state.openGoal) this.setState({ openGoal: fromUrl });
		};
		window.addEventListener("popstate", this.popstateHandler);
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.popstateHandler) window.removeEventListener("popstate", this.popstateHandler);
		this.popstateHandler = null;
	}

	private toggleGoal(domain: string): void {
		const next = this.state.openGoal === domain ? "" : domain;
		writeOpenGoalToUrl(next);
		this.setState({ openGoal: next });
	}

	/**
	 * View-open contract: `pane-opener` assigns this property with the products
	 * `show affordances` produced. The forward/goals shape is required — fail fast
	 * if either is missing, no fallbacks.
	 */
	set products(p: Record<string, unknown>) {
		if (!Array.isArray(p.forward) || !Array.isArray(p.goals)) {
			throw new Error(
				`shu-affordances-panel requires products with \`forward\` and \`goals\` arrays. Received keys: [${Object.keys(p).join(", ")}]. The step's productsDomain schema must include both fields; the action must populate them.`,
			);
		}
		this.applyAffordances({
			forward: p.forward as TAffordances["forward"],
			goals: p.goals as TAffordances["goals"],
			waypoints: Array.isArray(p.waypoints) ? (p.waypoints as TWaypointEntry[]) : undefined,
		});
	}

	private applyAffordances(a: TAffordances): void {
		// Live affordance events emitted by the goal-resolver after every step include
		// `forward` and `goals` but not `waypoints` — preserve the last known waypoints
		// across those updates so the section doesn't flicker out between explicit refreshes.
		const waypoints = a.waypoints ?? this.affordances?.waypoints;
		this.affordances = { ...a, waypoints };
		this.assertedDomains = new Set(a.goals.filter((g) => g.resolution.finding === GOAL_FINDING.SATISFIED).map((g) => g.domain));
		this.setState({ loadState: "loaded" });
	}

	private async fetchInitial(): Promise<void> {
		if (!this.sse) return;
		this.setState({ loadState: "fetching" });
		const asOf = this.getAttribute("as-of");
		const sse = this.sse;
		const params = asOf ? { asOf } : {};
		// Preferred entry: ActivitiesStepper-showWaypoints returns a superset (waypoints + forward + goals).
		// Fall back to GoalResolutionStepper-showAffordances when ActivitiesStepper is not loaded so the
		// panel still works in projects that don't use waypoints. The as-of replay path is goal-resolver
		// only — there is no waypoint history to replay.
		const candidates = asOf
			? ["GoalResolutionStepper-showAffordancesAsOf"]
			: ["ActivitiesStepper-showWaypoints", "GoalResolutionStepper-showAffordances"];

		let lastError = "";
		for (const method of candidates) {
			try {
				const response = await inAction((scope) => sse.rpc<Record<string, unknown>>(scope, method, params));
				if (Array.isArray(response?.forward) && Array.isArray(response?.goals)) {
					this.applyAffordances({
						forward: response.forward as TAffordances["forward"],
						goals: response.goals as TAffordances["goals"],
						waypoints: Array.isArray(response.waypoints) ? (response.waypoints as TWaypointEntry[]) : undefined,
					});
					return;
				}
				const keys = response && typeof response === "object" ? Object.keys(response).join(", ") : typeof response;
				lastError = `${method} returned an unrecognised shape. Expected {forward[], goals[]}; got keys [${keys}]. Full response: ${JSON.stringify(response).slice(0, 500)}`;
			} catch (err) {
				lastError = `RPC ${method} failed: ${errorDetail(err)}`;
				// Try the next candidate — typical reason is that the stepper providing the method is not loaded.
			}
		}
		this.setState({
			loadState: "loaded",
			fetchError: `${lastError}. The affordances panel cannot proceed without a snapshot — check the server log, confirm at least one of [${candidates.join(", ")}] is loaded, and confirm /rpc/<method> is reachable from this origin.`,
		});
	}

	static get observedAttributes(): string[] {
		return ["as-of"];
	}

	attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
		if (name === "as-of" && oldValue !== newValue && this.isConnected) void this.fetchInitial();
	}

	private chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method, args, auto }, bubbles: true, composed: true }));
	}

	/**
	 * Hand the first step of a path to the actions-bar step input so the user fills
	 * any required arguments. After it runs and asserts its product, the resolver
	 * sees the new fact and the next step becomes reachable through normal affordances.
	 */
	private startPath(path: TMichi): void {
		const first = path.steps[0];
		if (!first) return;
		this.chooseStep(stepMethodName(first.stepperName, first.stepName));
	}

	private renderBlockedReason(a: TForwardAffordance): string {
		if (!this.affordances) return "";
		const forward = this.affordances.forward;
		const missingTyped = a.inputDomains.filter((d) => !isArgumentDomain(d, forward) && !this.assertedDomains.has(d));
		if (missingTyped.length === 0 && a.capability) {
			return `<div class="blocked"><span class="blocked-label">Blocked:</span> requires capability <code>${esc(a.capability)}</code>. The granted-capability set the resolver was given does not include it.</div>`;
		}
		if (missingTyped.length === 0) return "";
		const producers = this.producersFor(missingTyped).filter((p) => p.readyToRun);
		const producerHtml =
			producers.length > 0
				? `<div class="blocked-producers">Producers ready to run: ${producers.map((p) => `<button class="produce" data-method="${escAttr(p.method)}"><code>${esc(p.gwta ?? p.method)}</code></button>`).join(" ")}</div>`
				: `<div class="blocked-producers">No producer step is registered. Add a step whose <code>productsDomain</code> matches, or assert ${missingTyped.length > 1 ? "these facts" : "this fact"} directly.</div>`;
		return `<div class="blocked"><span class="blocked-label">Blocked:</span> input${missingTyped.length > 1 ? "s" : ""} ${missingTyped.map((m) => `<code>${esc(m)}</code>`).join(", ")} ${missingTyped.length > 1 ? "have" : "has"} no asserted fact yet.${producerHtml}</div>`;
	}

	private producersFor(missing: string[]): TForwardAffordance[] {
		const fwd = this.affordances?.forward ?? [];
		const want = new Set(missing);
		return fwd.filter((a) => a.outputDomains.some((d) => want.has(d)));
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

	private renderResolution(g: TGoalAffordance, goalIdx: number): string {
		const r = g.resolution;
		if (r.finding === GOAL_FINDING.SATISFIED) {
			if (!Array.isArray(r.factIds)) throw new Error(`shu-affordances-panel: satisfied resolution for ${g.domain} has no factIds[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			const facts = r.factIds.map((id) => factIdRef(id)).join(", ");
			const plural = r.factIds.length === 1 ? "fact" : "facts";
			const factsHtml = `<div class="resolution-detail">already asserted as ${plural} ${facts}</div>`;
			// Satisfied does not mean terminal — render the run-again paths so the
			// user can produce another instance.
			if (Array.isArray(r.michi) && r.michi.length > 0) return factsHtml + this.renderMichiSection(r.michi, r.truncated, goalIdx, true);
			return factsHtml;
		}
		if (r.finding === GOAL_FINDING.MICHI) {
			if (!Array.isArray(r.michi)) throw new Error(`shu-affordances-panel: michi resolution for ${g.domain} has no michi[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return this.renderMichiSection(r.michi, r.truncated, goalIdx, false);
		}
		if (r.finding === GOAL_FINDING.UNREACHABLE) {
			if (!Array.isArray(r.missing)) throw new Error(`shu-affordances-panel: unreachable resolution for ${g.domain} has no missing[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return `<span class="resolution-detail">no producer chain. Missing leaves: ${r.missing.map((m) => `<code>${esc(m)}</code>`).join(", ")}</span>`;
		}
		if (r.finding === GOAL_FINDING.REFUSED) {
			if (typeof r.refusalReason !== "string" || typeof r.detail !== "string")
				throw new Error(`shu-affordances-panel: refused resolution for ${g.domain} is missing refusalReason or detail. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return `<span class="resolution-detail">refused: ${esc(r.refusalReason)} — ${esc(r.detail)}</span>`;
		}
		throw new Error(
			`shu-affordances-panel: unrecognised goal-resolution finding for ${g.domain}. Expected one of [${Object.values(GOAL_FINDING).join(", ")}]; got: ${JSON.stringify(r).slice(0, 200)}.`,
		);
	}

	/** Render the run-again / run-for-the-first-time section: heading, embedded goal-graph, path cards. */
	private renderMichiSection(michi: TMichi[], truncated: boolean, goalIdx: number, alreadySatisfied: boolean): string {
		const count = michi.length === 1 ? "1 way to reach this" : `${michi.length} ways to reach this`;
		const truncatedNote = truncated ? " (the resolver returned the first batch; more exist)" : "";
		const action = alreadySatisfied ? "Run again to produce another." : "Pick one to start; the first step opens in the actions bar so you can supply any inputs.";
		const heading = `${count}${truncatedNote}. ${action}`;
		const cards = michi.map((m, i) => this.renderPathCard(m, goalIdx, i)).join("");
		const graphId = `goal-graph-${goalIdx}`;
		return `<div class="resolution-detail"><div class="path-heading">${esc(heading)}</div><shu-graph class="goal-graph" data-testid="${escAttr(graphId)}" data-goal-idx="${goalIdx}"></shu-graph><div class="path-list">${cards}</div></div>`;
	}

	private renderPathCard(path: TMichi, goalIdx: number, pathIdx: number): string {
		if (!Array.isArray(path.steps)) throw new Error(`shu-affordances-panel: path[${pathIdx}] for goal ${goalIdx} has no steps[]. Got: ${JSON.stringify(path).slice(0, 200)}`);
		if (!Array.isArray(path.bindings)) throw new Error(`shu-affordances-panel: path[${pathIdx}] for goal ${goalIdx} has no bindings[]. Got: ${JSON.stringify(path).slice(0, 200)}`);
		const stepList = path.steps
			.map((s, i) => {
				if (typeof s.stepperName !== "string" || typeof s.stepName !== "string") {
					throw new Error(`shu-affordances-panel: path step[${i}] is missing stepperName or stepName. Got: ${JSON.stringify(s)}`);
				}
				return `<li><code>${esc(s.stepperName)}.${esc(s.stepName)}</code>${s.gwta ? ` — ${esc(s.gwta)}` : ""}</li>`;
			})
			.join("");
		const bindingsList = path.bindings.length > 0 ? this.renderBindings(path.bindings) : "";
		const cardId = `path-card-${goalIdx}-${pathIdx}`;
		const startId = `start-path-${goalIdx}-${pathIdx}`;
		const firstStepLabel = path.steps[0]?.gwta ?? `${path.steps[0]?.stepperName}.${path.steps[0]?.stepName}`;
		return `<div class="path-card" data-testid="${escAttr(cardId)}">
			<div class="path-card-header">
				<span class="path-label">Path ${pathIdx + 1}</span>
				<button class="start-path" data-testid="${escAttr(startId)}" data-goal-idx="${goalIdx}" data-path-idx="${pathIdx}" title="Open the first step (${esc(firstStepLabel)}) in the actions bar">Start this path</button>
			</div>
			<ol class="plan-steps">${stepList}</ol>
			${bindingsList}
		</div>`;
	}

	private renderBindings(bindings: TBinding[]): string {
		const parts = bindings.map((b, i) => {
			if (typeof b.domain !== "string") throw new Error(`shu-affordances-panel: binding[${i}] has no domain. Got: ${JSON.stringify(b)}`);
			if (b.kind === "fact") {
				if (typeof b.factId !== "string") throw new Error(`shu-affordances-panel: fact-binding[${i}] (domain ${b.domain}) has no factId. Got: ${JSON.stringify(b)}`);
				return `<span class="binding-fact">${esc(b.domain)}#${factIdRef(b.factId)}</span>`;
			}
			if (b.kind === "composite") {
				return this.renderCompositeBinding(b.domain, b.fields);
			}
			return `<code class="binding-arg">${esc(b.domain)} (you supply)</code>`;
		});
		return `<div class="bindings">inputs: ${parts.join(", ")}</div>`;
	}

	/**
	 * Render a composite binding as a nested tree of per-field bindings. Field
	 * bindings can themselves recurse into further composites (via topology.ranges
	 * chains). Fact / argument leaves render with the same vocabulary as flat
	 * bindings so the user sees "✓ existing fact" vs "(you supply)" at every level.
	 */
	private renderAsOfBanner(): string {
		const asOf = this.getAttribute("as-of");
		if (!asOf) return "";
		return `<div class="as-of-banner" data-testid="affordances-as-of">replay as of <code>${esc(asOf)}</code> — facts asserted after this seqPath are hidden. <button class="as-of-clear" data-testid="affordances-as-of-clear">back to live</button></div>`;
	}

	private renderCompositeBinding(domain: string, fields: TFieldBinding[]): string {
		const fieldHtml = fields
			.map((f) => {
				const typeLabel = f.fieldDomain || f.fieldType || "value";
				const optionalMark = f.optional ? "?" : "";
				const domainSuffix = `<span class="field-domain">: ${esc(typeLabel)}${optionalMark}</span>`;
				if (f.kind === "fact") return `<li><span class="field-name">${esc(f.fieldName)}</span>${domainSuffix} ${factIdRef(f.factId)}</li>`;
				if (f.kind === "composite")
					return `<li><span class="field-name">${esc(f.fieldName)}</span>${domainSuffix} ${this.renderCompositeBinding(f.fieldDomain || domain, f.fields)}</li>`;
				return `<li><span class="field-name">${esc(f.fieldName)}</span>${domainSuffix} <code class="binding-arg">(you supply)</code></li>`;
			})
			.join("");
		const detailsKey = `composite:${domain}`;
		return `<details class="composite-binding" data-key="${escAttr(detailsKey)}"><summary><code class="binding-composite">${esc(domain)}</code></summary><ul class="composite-fields">${fieldHtml}</ul></details>`;
	}

	private renderWaypointEntry(w: TWaypointEntry): string {
		const stateClass = w.currentlyValid ? "wp-valid" : "wp-pending";
		const stateLabel = w.currentlyValid ? "satisfied" : w.kind === "declarative" ? "needs activity" : "needs proof";
		const slotsHtml = w.paramSlots.length > 0 ? `<div class="wp-slots">slots: ${w.paramSlots.map((s) => `<code>${esc(s)}</code>`).join(", ")}</div>` : "";
		const proofHtml = w.proofStatements.length > 0 ? `<div class="wp-proof">proof: ${w.proofStatements.map((p) => `<code>${esc(p)}</code>`).join(" · ")}</div>` : "";
		const resolvesHtml = w.resolvesDomain ? `<div class="wp-resolves">resolves: <code>${esc(w.resolvesDomain)}</code></div>` : "";
		const errorHtml = w.error ? `<div class="wp-error">${esc(w.error)}</div>` : "";
		const id = `waypoint-${w.outcome}`;
		return `<div class="waypoint ${stateClass}" data-testid="${escAttr(id)}">
			<div class="wp-header">
				<span class="wp-outcome">${esc(w.outcome)}</span>
				<span class="wp-kind">${esc(w.kind)}</span>
				<span class="wp-state">${esc(stateLabel)}</span>
			</div>
			${resolvesHtml}
			${slotsHtml}
			${proofHtml}
			${errorHtml}
			<button class="wp-run" type="button" data-method="${escAttr(w.method)}" data-testid="${escAttr(id)}-run">Ensure</button>
		</div>`;
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const snapshot = this.snapshotUiState();
		const styles = SHARED_STYLES;
		const loading = this.state.loadState === "fetching";
		const empty = this.state.loadState === "idle" || this.state.loadState === "empty";
		const goals = this.affordances?.goals ?? [];
		const waypoints = this.affordances?.waypoints ?? [];

		const explanationHtml = `
			<details class="explanation" data-key="explanation">
				<summary>How this panel is computed</summary>
				<div class="explanation-body">
					<p>This view is a projection over the loaded steppers, registered domains, and the current working memory.</p>
					<ul>
						<li><strong>Goals</strong> are the domains some step can produce. For each, the resolver reports one of: <em>satisfied</em> (a fact already exists), <em>reachable</em> (one or more paths exist from the current state — pick one to start), <em>unreachable</em> (no producer chain), or <em>refused</em> (resolver cannot decide without more information).</li>
						<li>Clicking a step or <em>Start this path</em> opens the first step in the actions bar so you can supply any inputs and run it. Subsequent steps in a path become reachable through normal affordances after each step asserts its fact.</li>
					</ul>
				</div>
			</details>
		`;

		const openGoal = this.state.openGoal;
		const goalsHtml = goals
			.map((g, idx) => {
				const cls = `goal goal-${g.resolution.finding}${openGoal === g.domain ? " goal-open" : ""}`;
				const expanded = openGoal === g.domain ? "true" : "false";
				const detail = openGoal === g.domain ? this.renderResolution(g, idx) : "";
				return `<div class="${cls}" data-testid="goal-${escAttr(g.domain)}" data-goal-domain="${escAttr(g.domain)}">
					<button class="goal-header" type="button" data-goal-domain="${escAttr(g.domain)}" aria-expanded="${expanded}" data-testid="goal-${escAttr(g.domain)}-toggle">
						<div class="goal-heading">
							<span class="goal-description" data-testid="goal-${escAttr(g.domain)}-description">${esc(g.description)}</span>
							<code class="goal-name" data-testid="goal-${escAttr(g.domain)}-name">${esc(g.domain)}</code>
						</div>
						<span class="finding" data-testid="goal-${escAttr(g.domain)}-finding">${esc(findingLabel(g.resolution.finding))}</span>
					</button>
					${detail}
				</div>`;
			})
			.join("");

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
				.affordance.not-ready { border-left: 4px solid #b58105; }
				.choose { display: block; width: 100%; text-align: left; padding: 8px 10px; background: #fafafa; border: 0; cursor: pointer; font: inherit; color: inherit; }
				.affordance.ready .choose { background: #f0f8f2; }
				.affordance.not-ready .choose { background: #fdf6e3; color: #5a4a00; }
				.choose:hover { background: #e8f5e9; }
				.blocked { padding: 6px 10px; background: #fdf6e3; border-top: 1px solid #f0e0a0; color: #5a4a00; font-size: 12px; }
				.blocked-label { font-weight: 600; }
				.blocked code { background: #f0e0a0; padding: 0 4px; border-radius: 2px; }
				.blocked-producers { margin-top: 4px; font-size: 12px; color: #444; }
				.blocked-producers .produce { background: #f0f8f2; border: 1px solid #c5e0d0; color: #1a6b3c; padding: 2px 6px; border-radius: 3px; cursor: pointer; margin: 0 2px; font-size: 11px; }
				.blocked-producers .produce:hover { background: #d8edd8; }
				.blocked-producers code { background: transparent; padding: 0; }
				.name { font-weight: 500; color: #222; margin-bottom: 4px; }
				.row { font-size: 11px; color: #666; margin: 2px 0; font-family: monospace; }
				.row-label { display: inline-block; min-width: 60px; color: #888; }
				.domain { display: inline-block; margin-right: 6px; padding: 1px 4px; background: #eee; border-radius: 2px; }
				.domain-satisfied { background: #d8edd8; color: #1a6b3c; }
				.domain-pending { background: #f5f5f5; color: #666; }
				.domain .marker { font-weight: bold; }
				.domain-none { color: #aaa; font-style: italic; }
				.cap { font-size: 11px; color: #b58105; margin-top: 4px; font-family: monospace; }
				.goal { padding: 8px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; }
				.goal-satisfied { border-left: 4px solid #1a6b3c; }
				.goal-michi { border-left: 4px solid #2848a8; }
				.goal-unreachable { border-left: 4px solid #a02828; }
				.goal-refused { border-left: 4px solid #b58105; }
				.goal-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; margin: -8px -10px 0; background: transparent; border: 0; border-radius: 4px 4px 0 0; cursor: pointer; font: inherit; color: inherit; text-align: left; -webkit-user-select: text; user-select: text; }
				.goal-header * { -webkit-user-select: text; user-select: text; }
				.goal-header:hover { background: #eef3f8; }
				.goal-open .goal-header { background: #e3eaf5; }
				.goal-heading { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
				.goal-description { font-size: 13px; color: #222; line-height: 1.3; }
				.goal-name { font-size: 10px; color: #888; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
				.finding { font-size: 11px; padding: 2px 6px; border-radius: 2px; background: #eee; color: #444; }
				.goal-satisfied .finding { background: #d8edd8; color: #1a6b3c; }
				.goal-michi .finding { background: #d8e1f0; color: #2848a8; }
				.goal-unreachable .finding { background: #fdd; color: #a02828; }
				.goal-refused .finding { background: #fde6c4; color: #b58105; }
				.resolution-detail { display: block; margin-top: 6px; font-size: 12px; color: #333; }
				.resolution-detail code { background: #eee; padding: 0 4px; border-radius: 2px; font-size: 11px; }
				.plan-steps { margin: 4px 0 4px 16px; padding: 0; font-size: 12px; }
				.plan-steps li { margin: 2px 0; }
				.path-heading { font-size: 11px; color: #555; margin-bottom: 6px; }
				.goal-graph { display: block; margin: 6px 0; }
				.path-list { display: flex; flex-direction: column; gap: 6px; }
				.path-card { padding: 6px 8px; border: 1px solid #c8d0e0; border-radius: 3px; background: #f4f7fc; }
				.path-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
				.path-label { font-size: 11px; font-weight: 600; color: #2848a8; }
				.start-path { background: #2848a8; color: #fff; border: 0; border-radius: 3px; padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
				.start-path:hover { background: #1d3680; }
				.bindings { margin-top: 4px; font-size: 11px; color: #666; }
				.binding-fact { background: #d8edd8; color: #1a6b3c; }
				.binding-arg { background: #fde6c4; color: #b58105; }
				.binding-composite { background: #f4f0fa; color: #6a4f9a; }
				.composite-binding { display: inline-block; margin: 0 4px; }
				.composite-binding > summary { cursor: pointer; font-size: 11px; }
				.composite-fields { margin: 4px 0 4px 16px; padding: 0; list-style: disc; font-size: 11px; color: #444; }
				.composite-fields li { margin: 2px 0; }
				.field-name { font-weight: 500; }
				.field-domain { color: #6a4f9a; font-size: 10px; }
				.error { padding: 8px; background: #fdecec; color: #a02828; border-radius: 3px; margin: 4px 0; font-size: 12px; }
				.empty { color: #888; font-style: italic; font-size: 12px; padding: 6px 0; }
				.as-of-banner { padding: 6px 8px; background: #fff4d6; border: 1px solid #d6b257; border-radius: 3px; margin: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 8px; }
				.as-of-banner code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #fff; padding: 1px 4px; border-radius: 2px; }
				.as-of-clear { padding: 2px 8px; background: #fff; border: 1px solid #d6b257; border-radius: 2px; cursor: pointer; font: inherit; }
				.as-of-clear:hover { background: #ffeebf; }
				.waypoint { padding: 8px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; }
				.waypoint.wp-valid { border-left: 4px solid #1a6b3c; }
				.waypoint.wp-pending { border-left: 4px solid #b58105; }
				.wp-header { display: flex; gap: 8px; align-items: baseline; }
				.wp-outcome { flex: 1; font-size: 13px; }
				.wp-kind { font-size: 10px; color: #6a4f9a; letter-spacing: 0.3px; }
				.wp-state { font-size: 11px; padding: 2px 6px; border-radius: 2px; background: #eee; color: #444; }
				.wp-valid .wp-state { background: #d8edd8; color: #1a6b3c; }
				.wp-pending .wp-state { background: #fde6c4; color: #b58105; }
				.wp-resolves, .wp-slots, .wp-proof { font-size: 11px; color: #555; margin-top: 4px; }
				.wp-error { font-size: 11px; color: #a02828; margin-top: 4px; }
				.wp-run { margin-top: 6px; background: #2848a8; color: #fff; border: 0; border-radius: 3px; padding: 3px 10px; font: inherit; font-size: 11px; cursor: pointer; }
				.wp-run:hover { background: #1d3680; }
			</style>
			${explanationHtml}
			${this.renderAsOfBanner()}
			${this.state.fetchError ? `<div class="error">${esc(this.state.fetchError)}</div>` : ""}
			${loading ? '<shu-spinner visible status="Loading affordances…"></shu-spinner>' : ""}
			${empty ? `<div class="empty" data-testid="affordances-empty">No affordances yet. Invoke <code>show affordances</code> or <code>show waypoints</code> from the actions bar (Step mode) to populate this view, or run any step — every step end emits an affordances snapshot.</div>` : ""}
			${loading || empty || waypoints.length === 0 ? "" : sectionHeader("Waypoints", waypoints.length, "waypoints")}
			${loading || empty || waypoints.length === 0 ? "" : `<div data-testid="affordances-waypoints">${waypoints.map((w) => this.renderWaypointEntry(w)).join("")}</div>`}
			${loading || empty ? "" : sectionHeader("Goals", goals.length, "goals")}
			${loading || empty ? "" : `<div data-testid="affordances-goals">${goalsHtml || '<div class="empty">No goal-producing steps loaded.</div>'}</div>`}
		`;

		const goalsCopy = this.shadowRoot.querySelector('shu-copy-button[data-copy-id="goals"]') as (HTMLElement & { source: string }) | null;
		if (goalsCopy) goalsCopy.source = JSON.stringify(goals, null, 2);
		const waypointsCopy = this.shadowRoot.querySelector('shu-copy-button[data-copy-id="waypoints"]') as (HTMLElement & { source: string }) | null;
		if (waypointsCopy) waypointsCopy.source = JSON.stringify(waypoints, null, 2);

		for (const button of Array.from(this.shadowRoot.querySelectorAll<HTMLButtonElement>(".wp-run"))) {
			button.addEventListener("click", () => {
				const method = button.dataset.method;
				if (method) this.chooseStep(method);
			});
		}

		for (const button of Array.from(this.shadowRoot.querySelectorAll(".choose, .produce"))) {
			button.addEventListener("click", (e) => {
				const method = (e.currentTarget as HTMLElement).dataset.method;
				if (method) this.chooseStep(method);
			});
		}

		for (const headerButton of Array.from(this.shadowRoot.querySelectorAll<HTMLButtonElement>(".goal-header"))) {
			headerButton.addEventListener("click", () => {
				// Suppress the toggle if the user just drag-selected text inside the header —
				// copying the description should not also open/close the goal.
				const selection = headerButton.ownerDocument.getSelection?.();
				if (selection && selection.toString().length > 0) return;
				const domain = headerButton.dataset.goalDomain;
				if (domain) this.toggleGoal(domain);
			});
		}

		const clearAsOf = this.shadowRoot.querySelector(".as-of-clear");
		if (clearAsOf) clearAsOf.addEventListener("click", () => this.removeAttribute("as-of"));

		for (const button of Array.from(this.shadowRoot.querySelectorAll<HTMLButtonElement>(".start-path"))) {
			button.addEventListener("click", () => {
				const goalIdx = Number(button.dataset.goalIdx);
				const pathIdx = Number(button.dataset.pathIdx);
				const goal = this.affordances?.goals[goalIdx];
				if (!goal || goal.resolution.finding !== GOAL_FINDING.MICHI) return;
				const path = goal.resolution.michi[pathIdx];
				if (!path) return;
				this.startPath(path);
			});
		}

		// Only the open goal renders its resolution detail (and embedded
		// shu-graph). The closed goals stay as headers in the index, so
		// mermaid renders are bounded to one regardless of how many goals exist.
		for (const graphEl of Array.from(this.shadowRoot.querySelectorAll<HTMLElement>("shu-graph.goal-graph"))) {
			const goalIdx = Number(graphEl.dataset.goalIdx);
			const goal = this.affordances?.goals[goalIdx];
			if (!goal) continue;
			const r = goal.resolution;
			const michi = "michi" in r && Array.isArray(r.michi) ? r.michi : [];
			const factIds = r.finding === GOAL_FINDING.SATISFIED && Array.isArray(r.factIds) ? r.factIds : undefined;
			if (r.finding !== GOAL_FINDING.MICHI && r.finding !== GOAL_FINDING.SATISFIED) continue;
			const graph: TGraph = projectGoalPaths({ goal: goal.domain, finding: r.finding, michi, factIds });
			(graphEl as HTMLElement & { products: Record<string, unknown> }).products = { graph, options: {} };
			graphEl.addEventListener(SHU_EVENT.GRAPH_NODE_CLICK as string, (e) => {
				const detail = (e as CustomEvent).detail as { node?: { invokes?: { stepperName?: string; stepName?: string }; wasGeneratedBy?: { factId?: string } } };
				const invokes = detail?.node?.invokes;
				if (invokes?.stepperName && invokes?.stepName) {
					this.chooseStep(stepMethodName(invokes.stepperName, invokes.stepName));
					return;
				}
				// `wasGeneratedBy.factId` is the producing seqPath (string form).
				// Open the step-detail for that seqPath so the user can inspect the
				// asserted fact alongside the rest of the step's quads.
				const wasGeneratedBy = detail?.node?.wasGeneratedBy;
				if (typeof wasGeneratedBy?.factId === "string") {
					const head = wasGeneratedBy.factId.includes("#") ? wasGeneratedBy.factId.slice(0, wasGeneratedBy.factId.indexOf("#")) : wasGeneratedBy.factId;
					const seqPath = parseSeqPath(head);
					if (seqPath) PaneState.request({ paneType: "step-detail", seqPath });
				}
			});
			const cards = this.shadowRoot.querySelectorAll<HTMLElement>(`.path-card[data-testid^="path-card-${goalIdx}-"]`);
			for (const card of Array.from(cards)) {
				const pathIdx = Number(card.querySelector<HTMLButtonElement>(".start-path")?.dataset.pathIdx ?? -1);
				if (pathIdx < 0) continue;
				const highlight = (highlighted: string | undefined) => {
					(graphEl as HTMLElement & { products: Record<string, unknown> }).products = { graph, options: { highlightedPath: highlighted } };
				};
				card.addEventListener("mouseenter", () => highlight(pathId(pathIdx)));
				card.addEventListener("mouseleave", () => highlight(undefined));
			}
		}

		this.restoreUiState(snapshot);

		// Scroll only once per open-goal change; leaves manual scroll alone during live re-renders.
		if (!openGoal) this.lastScrolledGoal = "";
		else if (openGoal !== this.lastScrolledGoal) {
			const card = this.shadowRoot.querySelector<HTMLElement>(`[data-goal-domain="${CSS.escape(openGoal)}"]`);
			if (card) {
				requestAnimationFrame(() => card.scrollIntoView({ block: "start", behavior: "auto" }));
				this.lastScrolledGoal = openGoal;
			}
		}
	}
}
