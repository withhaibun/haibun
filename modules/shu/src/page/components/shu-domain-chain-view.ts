/**
 * ShuDomainChainView: the domain chain, drawn by the site's graph presenter.
 *
 * Projects the affordances snapshot (`projectDomainChain`): domains, waypoints and asserted facts as nodes of the kind
 * their goal verdict gives them, and the steps between them as edges labelled by the step. The presenter draws it with
 * the graph's own controls (fit, follow, prune, reading, layout, filters), mounted in light DOM and shown through a slot.
 * A node opens what it names: a fact the step that produced it, a domain or waypoint the affordances panel at it. The
 * affordances panel holds the view and gives it the affordances it reads; the view owns the deep-link selection and lists the
 * affordances' lint findings.
 */
import { html, css, type TemplateResult } from "lit";
import { shuBaseStyles } from "./styles.js";
import { z } from "zod";
import { producingStepOf, projectDomainChain, waypointNodeId, type TAffordancesSnapshot, type TWaypointSnapshot } from "../derivations/project-domain-chain.js";
import { graphToQuads } from "../derivations/graph-quads.js";
import { SHU_EVENT, AFFORDANCE_PARAM, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import * as PageHash from "../controllers/hash-controller.js";
import { deepLinkOf, followDeepLink, openRef, paneHref } from "./ref-navigation.js";
import { domainRef, stepRef } from "./shu-ref.js";
import { LINT_FINDING, LintFindingSchema, type TLintFinding } from "@haibun/core/lib/domains/goal-resolution.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { noteActualityFeature } from "../client-cache/controllers/device-controller.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";
import { NODE_KIND, nodeIn, type TGraph, type TGraphNode } from "../domains/graph.js";
import { graphPresenterTag, mountGraphPresenter, presenterIn } from "../controllers/presenter-controller.js";
import type { TGraphPresenter, TPresenterNodeClick } from "../ports.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { typeShownIn } from "../controllers/catalog-controller.js";
import "./shu-spinner.js";
import { emptyState } from "./empty-state.js";

/** Where the chain's graph is placed in the view, which is also the test id it is found by, and the scope it keeps its
 *  settings under. */
const CHAIN_GRAPH = { slot: SHU_TEST_IDS.DOMAIN_CHAIN.GRAPH, scope: "domain-chain" } as const;

/** Returns a snapshot of actuality's affordances, as a step's products or a read of them give it, and notes the actuality feature it
 *  is of: its facts are that actuality feature's, so the page reads that actuality feature, and a fact's step opens there. Throws for products
 *  that don't carry the snapshot. */
function snapshotOf(p: Record<string, unknown>): TAffordancesSnapshot {
	if (!Array.isArray(p.forward) || !Array.isArray(p.goals) || !Array.isArray(p.satisfiedDomains) || typeof p.actuality !== "string") {
		throw new Error(
			`shu-domain-chain-view takes \`forward\`, \`goals\` and \`satisfiedDomains\` arrays and the \`actuality\` that holds them. Received keys: [${Object.keys(p).join(", ")}].`,
		);
	}
	const snapshot: TAffordancesSnapshot = {
		forward: p.forward as TAffordancesSnapshot["forward"],
		goals: p.goals as TAffordancesSnapshot["goals"],
		composites: p.composites as TAffordancesSnapshot["composites"],
		waypoints: Array.isArray(p.waypoints) ? (p.waypoints as TWaypointSnapshot[]) : undefined,
		satisfiedDomains: p.satisfiedDomains as string[],
		satisfiedFacts: typeof p.satisfiedFacts === "object" && p.satisfiedFacts !== null ? (p.satisfiedFacts as Record<string, string[]>) : undefined,
	};
	noteActualityFeature(p.actuality);
	return snapshot;
}

export class ShuDomainChainView extends ShuElement<typeof EmptyStateSchema> {
	/** What the embedded graph shows of the chain. */
	summarizeForContext(): TLinkedData | null {
		if (!this.affordances) return null;
		return presenterIn(this, CHAIN_GRAPH.slot)?.summarizeForContext() ?? null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; font-family: inherit; }
		.header { display: flex; justify-content: space-between; align-items: baseline; padding: var(--shu-space-4) var(--shu-space-5) var(--shu-space-2); flex-shrink: 0; }
		.header h3 { margin: 0; font-size: var(--shu-font-md); color: var(--shu-fg-muted); }
		.explanation { padding: 0 var(--shu-space-5); flex-shrink: 0; }
		.explanation summary { cursor: pointer; font-size: var(--shu-font-md); color: var(--shu-fg-muted); padding: var(--shu-space-2) 0; }
		.explanation p { margin: var(--shu-space-2) 0; font-size: var(--shu-font-md); color: var(--shu-fg); }
		.empty {
			color: var(--shu-fg-muted); font-size: var(--shu-font-md); padding: var(--shu-space-5); margin: var(--shu-space-5);
			background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius);
		}
		.empty code { background: var(--shu-bg-elevated); padding: var(--shu-space-1) var(--shu-space-2); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); }
		.error {
			color: var(--shu-error); font-size: var(--shu-font-md); padding: var(--shu-space-4) var(--shu-space-5); margin: var(--shu-space-4) var(--shu-space-5);
			background: var(--shu-bg-error-soft); border: var(--shu-border-w) solid var(--shu-error); border-radius: var(--shu-radius);
		}
		.graph { flex: 1; min-height: 0; overflow: hidden; }
		::slotted([data-external]) { display: block; height: 100%; }
	`,
	];
	static domainSelector = SHU_TAG.DOMAIN_CHAIN_VIEW;

	/** The affordances as its host gave them, and the snapshot of them the chain draws; null before the host gives them. */
	#given: { offered: Record<string, unknown>; snapshot: TAffordancesSnapshot } | null = null;

	/** The affordances the chain draws, or null before its host gives them. */
	private get affordances(): TAffordancesSnapshot | null {
		return this.#given === null ? null : this.#given.snapshot;
	}

	/** The affordances its host gave, as the host gave them. */
	get products(): Record<string, unknown> | undefined {
		return this.#given?.offered;
	}

	/** The affordances its host reads, with their lint findings. */
	set products(p: Record<string, unknown>) {
		const snapshot = snapshotOf(p);
		this.findings = z.array(LintFindingSchema).parse(p.findings);
		this.#given = { offered: p, snapshot };
		this.requestUpdate();
	}
	/** Test-only accessor; production reads happen inside `render()`. */
	getAffordances(): TAffordancesSnapshot | null {
		return this.affordances;
	}
	/** The chain as last projected, in which a node a reader opens is found. */
	private graph: TGraph | null = null;

	constructor() {
		super(EmptyStateSchema);
	}

	protected override onConnected(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", SHU_TEST_IDS.DOMAIN_CHAIN.ROOT);
		this.autoListen(this, SHU_EVENT.GRAPH_NODE_CLICK, (e) => this.onNodeClick(e));
		// The address names the goal or waypoint the reader is on, which the graph marks as its active node.
		this.autoTeardown(PageHash.onHashChanged(() => presenterIn(this, CHAIN_GRAPH.slot)?.selectNode(this.addressedNode())));
	}

	/** What the chain shows before its host gives it the affordances. */
	private loadingTemplate(): TemplateResult {
		return html`<shu-spinner visible status="Loading domain chain…"></shu-spinner>`;
	}

	/** The ways the steps' chain is incomplete, as the affordances' lint finds them. */
	private findings: TLintFinding[] = [];

	/** One finding, its step and its domain each a link to its view. */
	private findingTpl(f: TLintFinding): TemplateResult {
		const step = (stepperName: string, stepName: string) => stepRef(stepMethodName(stepperName, stepName));
		switch (f.kind) {
			case LINT_FINDING.UNSUPPLIED_STEP:
				return html`${step(f.stepperName, f.stepName)} takes ${domainRef(f.inputDomain)}, which the steps don't return and a caller doesn't write`;
			case LINT_FINDING.UNREACHABLE_DOMAIN:
				return html`the steps don't take or return ${domainRef(f.domain)}`;
			case LINT_FINDING.UNPRODUCED_DOMAIN:
				return html`a step takes ${domainRef(f.domain)}, and the steps don't return it`;
		}
	}

	render(): TemplateResult {
		return this.affordances === null ? this.loadingTemplate() : this.chainTemplate();
	}

	/** The chain's header, its explanation and its graph. */
	private chainTemplate(): TemplateResult {
		return html`
			<div class="header"><h3>Domain chain</h3></div>
			<details class="explanation">
				<summary>How to read this</summary>
				<p>Domains, waypoints and asserted facts are nodes; the steps that take and return them are edges, labelled by the step. A ⚷ on a step means it needs a capability that has not been granted.</p>
				<p>A node's type is its verdict: satisfied, a fact exists; reachable, a path reaches it; unreachable or refused, the resolver's findings. The filter's type chips show and hide each verdict, and its property chips each step.</p>
				<p>Open a domain or waypoint to see it in the affordances panel. Open a fact instance to see the step that produced it.</p>
			</details>
			${
				graphPresenterTag()
					? html`<div class="graph" data-testid=${CHAIN_GRAPH.slot}><slot name=${CHAIN_GRAPH.slot}></slot></div>`
					: emptyState({
							message: "The site doesn't declare a graph view that draws the chain.",
							next: html`The <a href=${paneHref({ paneType: "component", tag: SHU_TAG.VIEWS_PICKER, label: "Views" })}>views</a> it declares.`,
						})
			}
			${
				this.findings.length
					? html`<details class="findings" open data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.FINDINGS}>
							<summary>${this.findings.length} findings</summary>
							<ul>${this.findings.map((f) => html`<li data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.FINDING}>${this.findingTpl(f)}</li>`)}</ul>
						</details>`
					: ""
			}
		`;
	}

	/** The chain is projected from each snapshot and given to the presenter, mounted once. */
	protected updated(): void {
		if (!this.affordances) return;
		this.graph = projectDomainChain(this.affordances);
		const presenter = presenterIn(this, CHAIN_GRAPH.slot);
		if (presenter) this.feed(presenter);
		else void mountGraphPresenter(this, CHAIN_GRAPH.slot, CHAIN_GRAPH.scope).then((mounted) => mounted && this.feed(mounted));
	}

	/** Give the presenter the chain, and the node the address names as its active node. */
	private feed(presenter: TGraphPresenter): void {
		if (!this.graph) return;
		const { quads, clusters } = graphToQuads(this.graph);
		presenter.setQuads(quads, clusters);
		presenter.selectNode(this.addressedNode());
	}

	/** The node the address names: its goal, else its waypoint; null where the address doesn't name either. */
	private addressedNode(): string | null {
		const goal = PageHash.hashParam(AFFORDANCE_PARAM.GOAL);
		const waypoint = PageHash.hashParam(AFFORDANCE_PARAM.WAYPOINT);
		return goal ? goal : waypoint ? waypointNodeId(waypoint) : null;
	}

	/** A node the reader opened in the graph opens what it names. */
	private onNodeClick(e: Event): void {
		const { nodeId } = (e as CustomEvent<TPresenterNodeClick>).detail;
		this.routeNodeClick(nodeIn(this.graph, nodeId, "the chain graph"));
	}

	/** Click router for a graph node. Public for testability. */
	routeNodeClick(node: TGraphNode): void {
		// A fact-instance node opens the step that produced the fact.
		const step = node.kind === NODE_KIND.factInstance ? producingStepOf(node) : undefined;
		if (step !== undefined) {
			openRef(this, { kind: REF_DENOTES.individual, target: { persistedAs: typeShownIn(SHU_TAG.STEP_DETAIL), id: step } }, false);
			return;
		}
		// Every other node of the chain projection deep-links into the affordances panel.
		const addressed = deepLinkOf(node.link?.href ?? "");
		if (!addressed) throw new Error(`chain node ${node.id} doesn't have a deep link to open`);
		followDeepLink(this, addressed);
	}
}

defineElement(SHU_TAG.DOMAIN_CHAIN_VIEW, ShuDomainChainView);
