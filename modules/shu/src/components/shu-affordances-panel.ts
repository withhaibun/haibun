/**
 * ShuAffordancesPanel: list of runnable steps and per-goal verdicts.
 *
 * Clicking a step hands the method to the actions-bar step input via STEP_CHOOSE:
 * the same flow as picking a step from the combo. The panel never invokes RPCs
 * itself; the step-caller in the actions-bar runs the step.
 */
import { html, css, type TemplateResult, type PropertyValues } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { shuBaseStyles } from "./styles.js";
import { conduit } from "../hypermedia.js";
import { type TEvent } from "../event-stream.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { GOAL_FINDING, type TMichi, type TBinding, type TFieldBinding } from "@haibun/core/lib/goal-resolver.js";
import {
	isArgumentDomain,
	AFFORDANCE_EVENT_PREFIX,
	type TForwardAffordance,
	type TGoalAffordance,
	type TWaypointEntry,
	satisfiedGoalDomains,
} from "@haibun/core/lib/affordances.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { RPC_METHOD, SHU_EVENT, AFFORDANCE_PARAM } from "../consts.js";
import * as ViewHash from "../view-hash.js";
import { pathNodeIds, projectGoalPaths } from "../graph/project-goal-paths.js";
import { graphToQuads } from "../graph/graph-quads.js";
import { mountGraphPresenter, presenterIn, type TGraphPresenter, type TPresenterNodeClick } from "../graph-presenter.js";
import { actionRef, domainRef, factIdRef } from "./shu-ref.js";
import { factSeqPath } from "@haibun/core/lib/seq-path.js";
import { openRef } from "./ref-navigation.js";
import type { TGraph } from "../graph/types.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { linkTo } from "../rpc-registry.js";
import { noteExecution } from "../client-cache/executions.js";

/** The panel's read-projection of the affordances wire blob: forward steps + goal verdicts (+ optional waypoints). forward/goals reuse the core element types; the panel ignores composites/satisfied* that the chain view consumes. */
type TAffordances = {
	/** The run whose facts these are, which is where a fact's step is: a fact's id is that step's seqPath. */
	execution: string;
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
	waypoints?: TWaypointEntry[];
};

/** A snapshot of the run's affordances, as a step's products or a read of them give it; refused where the forward
 *  steps, the goals or the run they are of is missing. */
function snapshotOf(p: Record<string, unknown>): TAffordances {
	if (!Array.isArray(p.forward) || !Array.isArray(p.goals) || typeof p.execution !== "string") {
		throw new Error(`shu-affordances-panel takes \`forward\` and \`goals\` arrays and the \`execution\` they are of. Received keys: [${Object.keys(p).join(", ")}].`);
	}
	return {
		execution: p.execution,
		forward: p.forward as TForwardAffordance[],
		goals: p.goals as TGoalAffordance[],
		waypoints: Array.isArray(p.waypoints) ? (p.waypoints as TWaypointEntry[]) : undefined,
	};
}

/** Human-readable label for a resolver finding. */
function findingLabel(finding: string): string {
	if (finding === GOAL_FINDING.MICHI) return "reachable";
	return finding;
}

const ShuAffordancesPanelSchema = z.object({
	loadState: z.enum(["idle", "fetching", "loaded"]).default("idle"),
	fetchError: z.string().default(""),
	openGoal: z.string().default(""),
	openWaypoint: z.string().default(""),
});

const AFF_GOAL_PARAM = AFFORDANCE_PARAM.GOAL;
const AFF_WAYPOINT_PARAM = AFFORDANCE_PARAM.WAYPOINT;
/** Coalesce the per-step change signals into at most one snapshot refetch per window: a run emits one signal per
 * step, and refetching per signal is the RPC flood (hundreds per run). */
const REFRESH_COALESCE_MS = 400;

/**
 * Mutually exclusive selections: when both URL params are set, the one that
 * differs from prior state wins; waypoint wins ties (more granular).
 */
function normalizeSelection(goalInUrl: string, waypointInUrl: string, priorGoal: string, priorWaypoint: string): { goal: string; waypoint: string } {
	if (!goalInUrl || !waypointInUrl) return { goal: goalInUrl, waypoint: waypointInUrl };
	const goalChanged = goalInUrl !== priorGoal;
	const waypointChanged = waypointInUrl !== priorWaypoint;
	if (waypointChanged && !goalChanged) return { goal: "", waypoint: waypointInUrl };
	if (goalChanged && !waypointChanged) return { goal: goalInUrl, waypoint: "" };
	return { goal: "", waypoint: waypointInUrl };
}

/** The scope every goal's graph keeps its settings under. */
const GOAL_GRAPH_SCOPE = "goal-graph";

/** The slot a goal's graph is shown in, which is also the test id its graph is found by. */
const goalGraphSlot = (domain: string): string => `goal-graph-${domain}`;

/** Draw a goal's projected paths in its presenter. */
const feedGoalGraph = (presenter: TGraphPresenter, graph: TGraph): void => {
	const { quads, clusters } = graphToQuads(graph);
	presenter.setQuads(quads, clusters);
};

export class ShuAffordancesPanel extends ShuElement<typeof ShuAffordancesPanelSchema> {
	private affordances: TAffordances | null = null;

	/** The discovery surface as linked data: every forward step (the deployment's callable verbs) and each goal's verdict: the core affordance shapes, uninvented. No served vocabulary term types this composite, so it carries none. */
	summarizeForKihan(): TLinkedData | null {
		if (!this.affordances) return null;
		return {
			"@id": "view:affordances",
			name: "the steps this deployment offers from its current state, and the stated goals with their resolutions",
			forward: this.affordances.forward.map((f) => ({
				method: f.method,
				gwta: f.gwta ?? "",
				inputDomains: f.inputDomains,
				outputDomains: f.outputDomains,
				readyToRun: f.readyToRun,
			})),
			goals: this.affordances.goals.map((g) => ({ domain: g.domain, description: g.description, resolution: g.resolution })),
		};
	}

	private assertedDomains: Set<string> = new Set();
	private lastScrolledGoal: string = "";
	private lastScrolledWaypoint: string = "";
	constructor() {
		const { goal, waypoint } = normalizeSelection(ViewHash.hashParam(AFF_GOAL_PARAM), ViewHash.hashParam(AFF_WAYPOINT_PARAM), "", "");
		super(ShuAffordancesPanelSchema, { loadState: "idle", fetchError: "", openGoal: goal, openWaypoint: waypoint });
	}

	protected override onConnected(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", "shu-affordances");
		// Each open goal's graph announces a click on a node, which crosses the shadow root to the host: heard here once.
		this.autoListen(this, SHU_EVENT.GRAPH_NODE_CLICK, (e) => this.onGraphNodeClick(e));
		// Hash restoration mounts the panel without products. Fetch the current snapshot
		// directly so real data shows instead of a forever-spinner. The setter path
		// still wins when products are threaded through (step invocation).
		if (this.affordances === null) void this.fetchInitial();
		// Every step end emits an `affordances.<seqPath>` artifact via the goal-resolution
		// stepper's afterStep cycle. Subscribing keeps the panel current; the snapshot/restore
		// helper preserves scroll, focus, and details-open state across re-renders.
		try {
			// afterStep emits a lean `affordances.<seqPath>` change signal (no payload), re-fetch the current snapshot.
			// Batched (rAF), so the connect-time history replay (one event per past step) collapses to ONE re-fetch per
			// frame rather than one RPC per replayed event: the spurious-RPC flood. Same batching primitive as the
			// timeline, the graph, and the app's pane router.
			this.autoTeardown(
				this.subscribeBatched({
					onBatch: () => this.scheduleRefresh(),
					filter: (event: TEvent) => typeof event.id === "string" && (event.id as string).startsWith(AFFORDANCE_EVENT_PREFIX),
				}),
			);
			this.autoTeardown(() => {
				if (this._refreshTimer !== undefined) clearTimeout(this._refreshTimer);
			});
		} catch {
			// No EventStream installed (test env without setupShuTest, standalone). Skip live updates.
		}
		// Back/forward navigation should re-sync the open goal / waypoint from the URL so the
		// panel reflects the address bar. Storing in history rather than state means
		// a copy-pasted URL also opens the right entry on first load.
		const fromHash = () => {
			const { goal, waypoint } = normalizeSelection(ViewHash.hashParam(AFF_GOAL_PARAM), ViewHash.hashParam(AFF_WAYPOINT_PARAM), this.state.openGoal, this.state.openWaypoint);
			// Write the normalized form back so the next reader sees a single selection.
			ViewHash.mergeHashParams({ [AFF_GOAL_PARAM]: goal, [AFF_WAYPOINT_PARAM]: waypoint });
			if (goal !== this.state.openGoal || waypoint !== this.state.openWaypoint) this.setState({ openGoal: goal, openWaypoint: waypoint });
		};
		this.autoTeardown(ViewHash.onHashChanged(fromHash));
	}

	private _refreshTimer: ReturnType<typeof setTimeout> | undefined;
	/** One refetch per coalesce window, no matter how many change signals arrive: the first signal starts the timer, and the rest fall inside it. */
	private scheduleRefresh(): void {
		if (this._refreshTimer !== undefined) return;
		this._refreshTimer = setTimeout(() => {
			this._refreshTimer = undefined;
			void this.fetchInitial(true);
		}, REFRESH_COALESCE_MS);
	}

	private toggleGoal(domain: string): void {
		const next = this.state.openGoal === domain ? "" : domain;
		ViewHash.mergeHashParams({ [AFF_GOAL_PARAM]: next });
		this.setState({ openGoal: next });
	}

	/**
	 * View-open contract: `pane-opener` assigns this property with the products
	 * `show affordances` produced. The forward/goals shape is required, fail fast
	 * if either is missing, no fallbacks.
	 */
	set products(p: Record<string, unknown>) {
		// app.ts coalesces the connect-time replay (one PaneState.request per pane per frame), so a burst never reaches
		// here: apply the latest synchronously. The products carry the whole snapshot, waypoints included.
		this.applyAffordances(snapshotOf(p));
	}

	/** A step on a path opens in the actions bar to be run; a fact opens the step that produced it. */
	/** A node a reader opened in a goal's graph: a step opens in the actions bar, a fact opens the step that produced it. */
	private onGraphNodeClick(e: Event): void {
		const { nodeId } = (e as CustomEvent<TPresenterNodeClick>).detail;
		const slot = (e.target as Element).slot;
		const node = this.goalGraphs.get(slot)?.nodes.find((n) => n.id === nodeId);
		if (!node) throw new Error(`goal graph node "${nodeId}" is no node of the graph in slot "${slot}"`);
		const invokes = node.invokes;
		if (invokes?.stepperName && invokes?.stepName) {
			this.chooseStep(stepMethodName(invokes.stepperName, invokes.stepName));
			return;
		}
		const factId = node.wasGeneratedBy?.factId;
		if (typeof factId !== "string") return;
		const seqPath = factSeqPath(factId);
		if (!seqPath) throw new Error(`fact "${factId}" names no step: a fact's id is the seqPath of the step that produced it`);
		openRef(e, "seqPath", { seqPath });
	}

	private applyAffordances(a: TAffordances): void {
		// Live affordance events emitted by the goal-resolver after every step include
		// `forward` and `goals` but not `waypoints`, preserve the last known waypoints
		// across those updates so the section doesn't flicker out between explicit refreshes.
		const waypoints = a.waypoints ?? this.affordances?.waypoints;
		this.affordances = { ...a, waypoints };
		// The facts shown are that run's, so it is the run the page reads, and a fact's step opens there.
		noteExecution(a.execution);
		this.assertedDomains = satisfiedGoalDomains(a.goals, GOAL_FINDING.SATISFIED);
		this.setState({ loadState: "loaded" });
	}

	private async fetchInitial(quiet = false): Promise<void> {
		// With no Conduit installed (standalone HTML pre-boot) there is no server to fetch
		// from. Stay on the actionable empty state rather than the spinner: the "invoke show
		// affordances" prompt shows, and the panel becomes useful once a snapshot arrives.
		// `quiet` (a live re-fetch on a change signal) skips the loadState transitions so the panel never flashes.
		try {
			conduit();
		} catch {
			if (!quiet) this.setState({ loadState: "idle" });
			return;
		}
		if (!quiet) this.setState({ loadState: "fetching" });
		const asOf = this.getAttribute("as-of");
		const params = asOf ? { asOf } : {};
		// The affordances on offer, read rather than shown: the whole snapshot (forward + goals + waypoints), asked of
		// the run without being recorded as an act of it. The as-of replay variant carries no waypoints: waypoint
		// ensure-state is current run state, so there is no waypoint history to replay.
		const candidates = asOf ? [RPC_METHOD.AFFORDANCES_ON_OFFER_AS_OF] : [RPC_METHOD.AFFORDANCES_ON_OFFER];

		let lastError = "";
		for (const method of candidates) {
			try {
				this.applyAffordances(snapshotOf(await conduit().follow<Record<string, unknown>>(linkTo(method, params), `affordances-panel: ${method}`)));
				return;
			} catch (err) {
				lastError = `RPC ${method} failed: ${errorDetail(err)}`;
				// Try the next candidate, typical reason is that the stepper providing the method is not loaded.
			}
		}
		if (!quiet)
			this.setState({
				loadState: "loaded",
				fetchError: `${lastError}. The affordances panel cannot proceed without a snapshot, check the server log, confirm at least one of [${candidates.join(", ")}] is loaded, and confirm /rpc/<method> is reachable from this origin.`,
			});
	}

	static observedHtmlAttributes = ["as-of"];

	protected override onAttributeChanged(name: string, oldValue: string | null, newValue: string | null): void {
		if (name === "as-of" && oldValue !== newValue && this.isConnected) void this.fetchInitial();
	}

	private chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method, args, auto }, bubbles: true, composed: true }));
	}

	/**
	 * Hand the first step of a path to the actions-bar step input for any required
	 * arguments. After it runs and asserts its product, the resolver
	 * sees the new fact and the next step becomes reachable through normal affordances.
	 */
	private startPath(path: TMichi): void {
		const first = path.steps[0];
		if (!first) return;
		this.chooseStep(stepMethodName(first.stepperName, first.stepName));
	}

	/** Each open goal's projected paths, keyed by the slot its graph is shown in: a node a reader opens, and a path a
	 *  reader points at, are found in it. */
	private goalGraphs = new Map<string, TGraph>();

	/** Light the nodes a path runs through in its goal's graph and dim the rest; no path ends the preview. */
	private previewPath(goalIdx: number, pathIdx: number | undefined): void {
		const slot = goalGraphSlot(this.goalDomainAt(goalIdx));
		const graph = this.goalGraphs.get(slot);
		if (!graph) return;
		presenterIn(this, slot)?.previewNodes(pathIdx === undefined ? null : pathNodeIds(graph, pathIdx));
	}

	private renderBlockedReasonTpl(a: TForwardAffordance): TemplateResult | "" {
		if (!this.affordances) return "";
		const forward = this.affordances.forward;
		const missingTyped = a.inputDomains.filter((d) => !isArgumentDomain(d, forward) && !this.assertedDomains.has(d));
		if (missingTyped.length === 0 && a.capability) {
			return html`<div class="blocked"><span class="blocked-label">Blocked:</span> requires capability ${actionRef(a.capability)}. The granted-capability set the resolver was given does not include it.</div>`;
		}
		if (missingTyped.length === 0) return "";
		const producers = this.producersFor(missingTyped).filter((p) => p.readyToRun);
		const producerTpl =
			producers.length > 0
				? html`<div class="blocked-producers">Producers ready to run: ${producers.map((p) => html`<button class="produce" @click=${(): void => this.chooseStep(p.method)}><code>${p.gwta ?? p.method}</code></button> `)}</div>`
				: html`<div class="blocked-producers">No producer step is registered. Add a step whose <code>productsDomain</code> matches, or assert ${missingTyped.length > 1 ? "these facts" : "this fact"} directly.</div>`;
		return html`<div class="blocked"><span class="blocked-label">Blocked:</span> input${missingTyped.length > 1 ? "s" : ""} ${missingTyped.map((m, i) => html`${i > 0 ? ", " : ""}${domainRef(m)}`)} ${missingTyped.length > 1 ? "have" : "has"} no asserted fact yet.${producerTpl}</div>`;
	}

	private producersFor(missing: string[]): TForwardAffordance[] {
		const fwd = this.affordances?.forward ?? [];
		const want = new Set(missing);
		return fwd.filter((a) => a.outputDomains.some((d) => want.has(d)));
	}

	private renderResolutionTpl(g: TGoalAffordance, goalIdx: number): TemplateResult {
		const r = g.resolution;
		if (r.finding === GOAL_FINDING.SATISFIED) {
			if (!Array.isArray(r.factIds)) throw new Error(`shu-affordances-panel: satisfied resolution for ${g.domain} has no factIds[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			// Build the static prefix as one string so lit-html doesn't insert a `<!--?lit-->` part marker between "as" and "fact(s)", readers (and tests) match the natural sentence "asserted as facts <id list>".
			const prefix = `already asserted as ${r.factIds.length === 1 ? "fact" : "facts"} `;
			const factsTpl = html`<div class="resolution-detail">${prefix}${r.factIds.map((id, i) => html`${i > 0 ? ", " : ""}${unsafeHTML(factIdRef(id))}`)}</div>`;
			// Satisfied is not terminal, render the run-again paths to produce another instance.
			if (Array.isArray(r.michi) && r.michi.length > 0) return html`${factsTpl}${this.renderMichiSectionTpl(r.michi, r.truncated, goalIdx, true)}`;
			return factsTpl;
		}
		if (r.finding === GOAL_FINDING.MICHI) {
			if (!Array.isArray(r.michi)) throw new Error(`shu-affordances-panel: michi resolution for ${g.domain} has no michi[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return this.renderMichiSectionTpl(r.michi, r.truncated, goalIdx, false);
		}
		if (r.finding === GOAL_FINDING.UNREACHABLE) {
			if (!Array.isArray(r.missing)) throw new Error(`shu-affordances-panel: unreachable resolution for ${g.domain} has no missing[]. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return html`<span class="resolution-detail">no producer chain. Missing leaves: ${r.missing.map((m, i) => html`${i > 0 ? ", " : ""}${domainRef(m)}`)}</span>`;
		}
		if (r.finding === GOAL_FINDING.REFUSED) {
			if (typeof r.refusalReason !== "string" || typeof r.detail !== "string")
				throw new Error(`shu-affordances-panel: refused resolution for ${g.domain} is missing refusalReason or detail. Got: ${JSON.stringify(r).slice(0, 200)}.`);
			return html`<span class="resolution-detail">refused: ${r.refusalReason}, ${r.detail}</span>`;
		}
		throw new Error(
			`shu-affordances-panel: unrecognised goal-resolution finding for ${g.domain}. Expected one of [${Object.values(GOAL_FINDING).join(", ")}]; got: ${JSON.stringify(r).slice(0, 200)}.`,
		);
	}

	/** Render the run-again / run-for-the-first-time section: heading, embedded goal-graph, path cards. */
	private renderMichiSectionTpl(michi: TMichi[], truncated: boolean, goalIdx: number, alreadySatisfied: boolean): TemplateResult {
		const count = michi.length === 1 ? "1 way to reach this" : `${michi.length} ways to reach this`;
		const truncatedNote = truncated ? " (the resolver returned the first batch; more exist)" : "";
		const action = alreadySatisfied ? "Run again to produce another." : "Pick one to start; the first step opens in the actions bar so you can supply any inputs.";
		return html`<div class="resolution-detail">
			<div class="path-heading">${count}${truncatedNote}. ${action}</div>
			<div class="goal-graph" data-testid=${goalGraphSlot(this.goalDomainAt(goalIdx))} data-goal-idx=${goalIdx}><slot name=${goalGraphSlot(this.goalDomainAt(goalIdx))}></slot></div>
			<div class="path-list">${michi.map((m, i) => this.renderPathCardTpl(m, goalIdx, i))}</div>
		</div>`;
	}

	/** The domain of the goal at an index: what a test id names a goal's parts by, since a goal's place in the list moves
	 *  as other goals come and go. */
	private goalDomainAt(goalIdx: number): string {
		const domain = this.affordances?.goals[goalIdx]?.domain;
		if (domain === undefined) throw new Error(`shu-affordances-panel: no goal at ${goalIdx}`);
		return domain;
	}

	private renderPathCardTpl(path: TMichi, goalIdx: number, pathIdx: number): TemplateResult {
		if (!Array.isArray(path.steps)) throw new Error(`shu-affordances-panel: path[${pathIdx}] for goal ${goalIdx} has no steps[]. Got: ${JSON.stringify(path).slice(0, 200)}`);
		if (!Array.isArray(path.bindings)) throw new Error(`shu-affordances-panel: path[${pathIdx}] for goal ${goalIdx} has no bindings[]. Got: ${JSON.stringify(path).slice(0, 200)}`);
		for (const [i, s] of path.steps.entries()) {
			if (typeof s.stepperName !== "string" || typeof s.stepName !== "string") {
				throw new Error(`shu-affordances-panel: path step[${i}] is missing stepperName or stepName. Got: ${JSON.stringify(s)}`);
			}
		}
		const firstStepLabel = path.steps[0]?.gwta ?? `${path.steps[0]?.stepperName}.${path.steps[0]?.stepName}`;
		return html`<div class="path-card" data-testid=${`path-card-${goalIdx}-${pathIdx}`} @mouseenter=${(): void => this.previewPath(goalIdx, pathIdx)} @mouseleave=${(): void => this.previewPath(goalIdx, undefined)}>
			<div class="path-card-header">
				<span class="path-label">Path ${pathIdx + 1}</span>
				<button class="start-path" data-testid=${`start-path-${this.goalDomainAt(goalIdx)}-${pathIdx}`} data-goal-idx=${goalIdx} data-path-idx=${pathIdx} title=${`Open the first step (${firstStepLabel}) in the actions bar`} @click=${(): void => this.startPath(path)}>Start this path</button>
			</div>
			<ol class="plan-steps">${path.steps.map((s) => html`<li>${actionRef(stepMethodName(s.stepperName, s.stepName))}${s.gwta ? html`, ${s.gwta}` : ""}</li>`)}</ol>
			${path.bindings.length > 0 ? this.renderBindingsTpl(path.bindings) : ""}
		</div>`;
	}

	private renderBindingsTpl(bindings: TBinding[]): TemplateResult {
		return html`<div class="bindings">inputs: ${bindings.map((b, i) => {
			if (typeof b.domain !== "string") throw new Error(`shu-affordances-panel: binding[${i}] has no domain. Got: ${JSON.stringify(b)}`);
			const sep = i > 0 ? html`, ` : "";
			if (b.kind === "fact") {
				if (typeof b.factId !== "string") throw new Error(`shu-affordances-panel: fact-binding[${i}] (domain ${b.domain}) has no factId. Got: ${JSON.stringify(b)}`);
				return html`${sep}<span class="binding-fact">${domainRef(b.domain)}#${unsafeHTML(factIdRef(b.factId))}</span>`;
			}
			if (b.kind === "composite") return html`${sep}${this.renderCompositeBindingTpl(b.domain, b.fields)}`;
			return html`${sep}<span class="binding-arg">${domainRef(b.domain)} (you supply)</span>`;
		})}</div>`;
	}

	private renderAsOfBannerTpl(): TemplateResult | "" {
		const asOf = this.getAttribute("as-of");
		if (!asOf) return "";
		return html`<div class="as-of-banner" data-testid="affordances-as-of">replay as of <code>${asOf}</code>, facts asserted after this seqPath are hidden. <button class="as-of-clear" data-testid="affordances-as-of-clear" @click=${(): void => this.removeAttribute("as-of")}>back to live</button></div>`;
	}

	/** Render a composite binding as a nested tree of per-field bindings. Field bindings can recurse into further composites (via topology.ranges chains). Fact / argument leaves render with the same vocabulary as flat bindings, "✓ existing fact" vs "(you supply)" at every level. */
	private renderCompositeBindingTpl(domain: string, fields: TFieldBinding[]): TemplateResult {
		const detailsKey = `composite:${domain}`;
		return html`<details class="composite-binding" open data-key=${detailsKey}><summary><span class="binding-composite">${domainRef(domain)}</span></summary><ul class="composite-fields">${fields.map(
			(f) => {
				const typeLabel = f.fieldDomain || f.fieldType || "value";
				const optionalMark = f.optional ? "?" : "";
				const domainSuffix = html`<span class="field-domain">: ${typeLabel}${optionalMark}</span>`;
				if (f.kind === "fact") return html`<li><span class="field-name">${f.fieldName}</span>${domainSuffix} ${unsafeHTML(factIdRef(f.factId))}</li>`;
				if (f.kind === "composite")
					return html`<li><span class="field-name">${f.fieldName}</span>${domainSuffix} ${this.renderCompositeBindingTpl(f.fieldDomain || domain, f.fields)}</li>`;
				return html`<li><span class="field-name">${f.fieldName}</span>${domainSuffix} <code class="binding-arg">(you supply)</code></li>`;
			},
		)}</ul></details>`;
	}

	private renderWaypointEntryTpl(w: TWaypointEntry): TemplateResult {
		const stateClass = w.ensured ? "wp-ensured" : "wp-pending";
		const stateLabel = w.ensured ? "ensured" : w.kind === "declarative" ? "needs activity" : "needs proof";
		return html`<div class=${`waypoint ${stateClass}`} data-testid=${`waypoint-${w.outcome}`}>
			<div class="wp-header">
				<span class="wp-outcome">${w.outcome}</span>
				<span class="wp-kind">${w.kind}</span>
				<span class="wp-state">${stateLabel}</span>
			</div>
			${w.resolvesDomain ? html`<div class="wp-resolves">resolves: ${domainRef(w.resolvesDomain)}</div>` : ""}
			${w.paramSlots.length > 0 ? html`<div class="wp-slots">slots: ${w.paramSlots.map((s, i) => html`${i > 0 ? ", " : ""}<code>${s}</code>`)}</div>` : ""}
			${w.proofStatements.length > 0 ? html`<div class="wp-proof">proof: ${w.proofStatements.map((p, i) => html`${i > 0 ? " · " : ""}<code>${p}</code>`)}</div>` : ""}
			${w.error ? html`<div class="wp-error">${w.error}</div>` : ""}
			<button class="wp-run" type="button" data-testid=${`waypoint-${w.outcome}-run`} @click=${(): void => this.chooseStep(w.method)}>Ensure</button>
		</div>`;
	}

	/** Layout-only: colours, badges, state borders all come from SHU_BASE token primitives. */
	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; padding: var(--shu-space-5); }
		h3 { margin: 0; font-size: var(--shu-font-md); color: var(--shu-fg-muted); }
		.section-header { display: flex; justify-content: space-between; align-items: baseline; margin: var(--shu-space-5) 0 var(--shu-space-3); }
		.explanation { margin-bottom: var(--shu-space-5); padding: var(--shu-space-4); background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); }
		.explanation summary { cursor: pointer; }
		.explanation-body { padding: var(--shu-space-3) 0; }
		.explanation-body p { margin: var(--shu-space-2) 0; }
		.explanation-body ul { margin: var(--shu-space-2) 0; padding-left: var(--shu-space-6); }
		.affordance { border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); margin: var(--shu-space-2) 0; overflow: hidden; }
		.affordance.ready { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-success); }
		.affordance.not-ready { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-warn); }
		.choose { display: block; width: 100%; text-align: left; padding: var(--shu-space-4) var(--shu-space-5); background: var(--shu-bg-soft); border: 0; cursor: pointer; font: inherit; color: inherit; border-radius: 0; }
		.affordance.ready .choose { background: var(--shu-accent-soft); }
		.affordance.not-ready .choose { background: var(--shu-bg-warn-soft); color: var(--shu-warn); }
		.choose:hover { background: var(--shu-bg-hover); }
		.blocked { padding: var(--shu-space-3) var(--shu-space-5); background: var(--shu-bg-warn-soft); border-top: var(--shu-border-w) solid var(--shu-border-warn); color: var(--shu-warn); }
		.blocked-label { font-weight: 600; }
		.blocked-producers { margin-top: var(--shu-space-2); color: var(--shu-fg-muted); }
		.blocked-producers .produce { background: var(--shu-accent-soft); border: var(--shu-border-w) solid var(--shu-success); color: var(--shu-success); padding: var(--shu-space-1) var(--shu-space-3); margin: 0 var(--shu-space-1); }
		.blocked-producers .produce:hover { filter: brightness(1.05); }
		.blocked-producers code { background: transparent; padding: 0; }
		.goal { padding: var(--shu-space-4) var(--shu-space-5); margin: var(--shu-space-2) 0; border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); background: var(--shu-bg-soft); }
		.goal-satisfied { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-success); }
		.goal-michi { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-info); }
		.goal-unreachable { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-error); }
		.goal-refused { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-warn); }
		.goal-header { display: flex; justify-content: space-between; align-items: center; gap: var(--shu-space-4); width: 100%; padding: var(--shu-space-3) var(--shu-space-4); margin: calc(var(--shu-space-4) * -1) calc(var(--shu-space-5) * -1) 0; background: transparent; border: 0; cursor: pointer; font: inherit; color: inherit; text-align: left; -webkit-user-select: text; user-select: text; }
		.goal-header * { -webkit-user-select: text; user-select: text; }
		.goal-header:hover { background: var(--shu-bg-hover); }
		.goal-open .goal-header { background: var(--shu-bg-info-soft); }
		.goal-heading { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
		.goal-description { line-height: 1.3; }
		.goal-name { font-size: var(--shu-font-xs); color: var(--shu-fg-faded); }
		.goal-satisfied .finding { background: var(--shu-bg-success-soft); color: var(--shu-success); }
		.goal-michi .finding { background: var(--shu-bg-info-soft); color: var(--shu-info); }
		.goal-unreachable .finding { background: var(--shu-bg-error-soft); color: var(--shu-error); }
		.goal-refused .finding { background: var(--shu-bg-warn-soft); color: var(--shu-warn); }
		.finding { display: inline-block; padding: 0 var(--shu-space-3); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); background: var(--shu-bg-elevated); color: var(--shu-fg-muted); }
		.resolution-detail { display: block; margin-top: var(--shu-space-3); color: var(--shu-fg); }
		.plan-steps { margin: var(--shu-space-2) 0 var(--shu-space-2) var(--shu-space-6); padding: 0; font-size: var(--shu-font-sm); }
		.plan-steps li { margin: var(--shu-space-1) 0; }
		.path-heading { color: var(--shu-fg-muted); margin-bottom: var(--shu-space-3); }
		.goal-graph { display: block; height: 320px; margin: var(--shu-space-3) 0; }
		::slotted([data-external]) { display: block; height: 100%; }
		.path-list { display: flex; flex-direction: column; gap: var(--shu-space-3); }
		.path-card { padding: var(--shu-space-3) var(--shu-space-4); border: var(--shu-border-w) solid var(--shu-border-info); border-radius: var(--shu-radius); background: var(--shu-bg-info-card); }
		.path-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--shu-space-2); }
		.path-label { font-weight: 600; color: var(--shu-info); }
		.start-path { background: var(--shu-info); color: var(--shu-info-fg); border: 0; }
		.start-path:hover { filter: brightness(1.1); }
		.bindings { margin-top: var(--shu-space-2); color: var(--shu-fg-muted); }
		.binding-fact { background: var(--shu-bg-success-soft); color: var(--shu-success); padding: 0 var(--shu-space-2); border-radius: var(--shu-radius); }
		.binding-arg { background: var(--shu-bg-warn-soft); color: var(--shu-warn); }
		.binding-composite { background: var(--shu-pred-soft); color: var(--shu-pred); }
		.composite-binding { display: inline-block; margin: 0 var(--shu-space-2); }
		.composite-binding > summary { cursor: pointer; }
		.composite-fields { margin: var(--shu-space-2) 0 var(--shu-space-2) var(--shu-space-6); padding: 0; list-style: disc; color: var(--shu-fg-muted); }
		.composite-fields li { margin: var(--shu-space-1) 0; }
		.field-name { font-weight: 500; }
		.field-domain { color: var(--shu-pred); font-size: var(--shu-font-xs); }
		.as-of-banner { padding: var(--shu-space-3) var(--shu-space-4); background: var(--shu-bg-warn-soft); border: var(--shu-border-w) solid var(--shu-border-warn); border-radius: var(--shu-radius); margin: var(--shu-space-2) 0; display: flex; align-items: center; gap: var(--shu-space-4); }
		.as-of-banner code { background: var(--shu-bg); }
		.as-of-clear { background: var(--shu-bg); border: var(--shu-border-w) solid var(--shu-border-warn); }
		.waypoint { padding: var(--shu-space-4) var(--shu-space-5); margin: var(--shu-space-2) 0; border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); background: var(--shu-bg-soft); }
		.waypoint.wp-ensured { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-success); }
		.waypoint.wp-pending { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-warn); }
		.wp-header { display: flex; gap: var(--shu-space-4); align-items: baseline; }
		.wp-outcome { flex: 1; }
		.wp-kind { font-size: var(--shu-font-xs); color: var(--shu-pred); letter-spacing: 0.3px; }
		.wp-state { font-size: var(--shu-font-sm); padding: 0 var(--shu-space-3); border-radius: var(--shu-radius); background: var(--shu-bg-elevated); color: var(--shu-fg-muted); }
		.wp-ensured .wp-state { background: var(--shu-bg-success-soft); color: var(--shu-success); }
		.wp-pending .wp-state { background: var(--shu-bg-warn-soft); color: var(--shu-warn); }
		.wp-resolves, .wp-slots, .wp-proof { color: var(--shu-fg-muted); margin-top: var(--shu-space-2); }
		.wp-error { color: var(--shu-error); margin-top: var(--shu-space-2); }
		.wp-run { margin-top: var(--shu-space-3); background: var(--shu-info); color: var(--shu-info-fg); border: 0; }
		.wp-run:hover { filter: brightness(1.1); }
	`,
	];

	render(): TemplateResult {
		const loading = this.state.loadState === "fetching";
		const empty = this.state.loadState === "idle";
		const goals = this.affordances?.goals ?? [];
		const waypoints = this.affordances?.waypoints ?? [];
		const openGoal = this.state.openGoal;
		const goalsCopySource = JSON.stringify(goals, null, 2);
		const waypointsCopySource = JSON.stringify(waypoints, null, 2);
		return html`
			${this.affordances ? unsafeHTML(this.emitHypermediaScript({ "@type": "goal-affordances", ...this.affordances })) : ""}
			<details class="explanation" data-key="explanation">
				<summary>How this panel is computed</summary>
				<div class="explanation-body">
					<p>This view is a projection over the loaded steppers, registered domains, and the current working memory.</p>
					<ul>
						<li><strong>Goals</strong> are the domains some step can produce. For each, the resolver reports one of: <em>satisfied</em> (a fact already exists), <em>reachable</em> (one or more paths exist from the current state, pick one to start), <em>unreachable</em> (no producer chain), or <em>refused</em> (resolver cannot decide without more information).</li>
						<li>Clicking a step or <em>Start this path</em> opens the first step in the actions bar so you can supply any inputs and run it. Subsequent steps in a path become reachable through normal affordances after each step asserts its fact.</li>
					</ul>
				</div>
			</details>
			${this.renderAsOfBannerTpl()}
			${this.state.fetchError ? html`<div class="banner error">${this.state.fetchError}</div>` : ""}
			${loading ? html`<shu-spinner visible status="Loading affordances…"></shu-spinner>` : ""}
			${empty ? html`<div class="empty" data-testid="affordances-empty">No affordances yet. Invoke <code>show affordances</code> from the actions bar (Step mode) to populate this view, or run any step: every step end announces a change this panel follows.</div>` : ""}
			${
				!loading && !empty && waypoints.length > 0
					? html`
				<div class="section-header"><h3>Waypoints (${waypoints.length})</h3><shu-copy-button data-copy-id="waypoints" label="Copy" title="Copy Waypoints JSON to clipboard" .source=${waypointsCopySource}></shu-copy-button></div>
				<div data-testid="affordances-waypoints">${waypoints.map((w) => this.renderWaypointEntryTpl(w))}</div>
			`
					: ""
			}
			${
				!loading && !empty
					? html`
				<div class="section-header"><h3>Goals (${goals.length})</h3><shu-copy-button data-copy-id="goals" label="Copy" title="Copy Goals JSON to clipboard" .source=${goalsCopySource}></shu-copy-button></div>
				<div data-testid="affordances-goals">${goals.length === 0 ? html`<div class="empty">No goal-producing steps loaded.</div>` : goals.map((g, idx) => this.renderGoalTpl(g, idx, openGoal))}</div>
			`
					: ""
			}
		`;
	}

	private renderGoalTpl(g: TGoalAffordance, idx: number, openGoal: string): TemplateResult {
		if (typeof g.description !== "string")
			throw new Error(
				`shu-affordances-panel: goal "${g.domain}" is missing a description. The goal-domain registry must declare one, see TRegisteredDomain.description. Got: ${JSON.stringify(g).slice(0, 200)}.`,
			);
		const isOpen = openGoal === g.domain;
		const cls = `goal goal-${g.resolution.finding}${isOpen ? " goal-open" : ""}`;
		const isSatisfied = g.resolution.finding === GOAL_FINDING.SATISFIED && Array.isArray(g.resolution.factIds) && g.resolution.factIds.length > 0;
		return html`<div class=${cls} data-testid=${`goal-${g.domain}`} data-goal-domain=${g.domain}>
			<button class="goal-header" type="button" data-goal-domain=${g.domain} aria-expanded=${isOpen ? "true" : "false"} data-testid=${`goal-${g.domain}-toggle`} @click=${(e: Event): void => this.onGoalHeaderClick(e, g.domain)}>
				<div class="goal-heading">
					<span class="goal-description" data-testid=${`goal-${g.domain}-description`}>${g.description}</span>
					<code class="goal-name" data-testid=${`goal-${g.domain}-name`}>${g.domain}</code>
				</div>
				<span class="finding" data-testid=${`goal-${g.domain}-finding`}>${findingLabel(g.resolution.finding)}</span>
			</button>
			${isSatisfied && "factIds" in g.resolution ? html`<div class="goal-fact-summary" data-testid=${`goal-${g.domain}-facts`}>${(g.resolution.factIds as string[]).map((id, i) => html`${i > 0 ? ", " : ""}${unsafeHTML(factIdRef(id))}`)}</div>` : ""}
			${isOpen ? this.renderResolutionTpl(g, idx) : ""}
		</div>`;
	}

	/** Header click intercepts text selection: a drag-select of the description (to copy it) must not also toggle open/closed. Otherwise route to `toggleGoal`. */
	private onGoalHeaderClick(e: Event, domain: string): void {
		const button = e.currentTarget as HTMLElement;
		const selection = button.ownerDocument.getSelection?.();
		if (selection && selection.toString().length > 0) return;
		this.toggleGoal(domain);
	}

	protected updated(_changedProperties: PropertyValues): void {
		if (!this.shadowRoot) return;
		// Each open goal's paths are projected and drawn by the site's graph presenter, mounted in light DOM in the goal's
		// slot. A presenter whose goal is no longer open goes with it.
		this.goalGraphs.clear();
		for (const wrapper of Array.from(this.shadowRoot.querySelectorAll<HTMLElement>(".goal-graph"))) {
			const goal = this.affordances?.goals[Number(wrapper.dataset.goalIdx)];
			if (!goal) continue;
			const r = goal.resolution;
			if (r.finding !== GOAL_FINDING.MICHI && r.finding !== GOAL_FINDING.SATISFIED) continue;
			const michi = "michi" in r && Array.isArray(r.michi) ? r.michi : [];
			const factIds = r.finding === GOAL_FINDING.SATISFIED && Array.isArray(r.factIds) ? r.factIds : undefined;
			const graph: TGraph = projectGoalPaths({ goal: goal.domain, finding: r.finding, michi, factIds });
			const slot = goalGraphSlot(goal.domain);
			this.goalGraphs.set(slot, graph);
			const presenter = presenterIn(this, slot);
			if (presenter) feedGoalGraph(presenter, graph);
			else void mountGraphPresenter(this, slot, GOAL_GRAPH_SCOPE).then((mounted) => mounted && feedGoalGraph(mounted, graph));
		}
		for (const presenter of Array.from(this.querySelectorAll<HTMLElement>(":scope > [data-external]"))) if (!this.goalGraphs.has(presenter.slot)) presenter.remove();

		// Scroll only once per open-goal / open-waypoint change; leaves manual scroll alone during live re-renders. Walk the relevant data attribute to find the card, avoiding `CSS.escape` (jsdom doesn't ship it) and domain-name characters that need CSS-attribute-selector escaping.
		const openGoal = this.state.openGoal;
		const openWaypoint = this.state.openWaypoint;
		const findByAttr = (attr: string, value: string): HTMLElement | null => {
			for (const el of Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>(`[${attr}]`) ?? [])) {
				if (el.getAttribute(attr) === value) return el;
			}
			return null;
		};
		if (!openGoal) this.lastScrolledGoal = "";
		else if (openGoal !== this.lastScrolledGoal) {
			const card = findByAttr("data-goal-domain", openGoal);
			if (card) {
				requestAnimationFrame(() => card.scrollIntoView({ block: "start", behavior: "auto" }));
				this.lastScrolledGoal = openGoal;
			}
		}
		if (!openWaypoint) this.lastScrolledWaypoint = "";
		else if (openWaypoint !== this.lastScrolledWaypoint) {
			const card = findByAttr("data-testid", `waypoint-${openWaypoint}`);
			if (card) {
				requestAnimationFrame(() => card.scrollIntoView({ block: "start", behavior: "auto" }));
				this.lastScrolledWaypoint = openWaypoint;
			}
		}
	}
}
