/**
 * ShuDomainChainView: the domain chain, drawn by the site's graph presenter.
 *
 * Projects the affordances snapshot (`projectDomainChain`): domains, waypoints and asserted facts as nodes of the kind
 * their goal verdict gives them, and the steps between them as edges labelled by the step. The presenter draws it with
 * the graph's own controls (fit, follow, prune, reading, layout, filters), mounted in light DOM and shown through a slot.
 * A node opens what it names: a fact the step that produced it, a domain or waypoint the affordances panel at it. The
 * view owns the live refetch, the deep-link selection and the findings of a chain lint report.
 */
import { html, css, type TemplateResult } from "lit";
import { shuBaseStyles } from "./styles.js";
import { z } from "zod";
import { conduit } from "../hypermedia.js";
import { type TEvent } from "../event-stream.js";
import { AFFORDANCE_EVENT_PREFIX } from "@haibun/core/lib/affordances.js";
import { projectDomainChain, waypointNodeId, type TAffordancesSnapshot, type TWaypointSnapshot } from "../graph/project-domain-chain.js";
import { graphToQuads } from "../graph/graph-quads.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SHU_EVENT, AFFORDANCE_PARAM, RPC_METHOD, SHU_TAG } from "../consts.js";
import { defineElement } from "../define-element.js";
import * as ViewHash from "../view-hash.js";
import { producingStep } from "@haibun/core/lib/seq-path.js";
import { deepLinkOf, followDeepLink, openRef } from "./ref-navigation.js";
import { domainRef, stepRef } from "./shu-ref.js";
import { LINT_FINDING, LintFindingSchema, type TLintFinding } from "@haibun/core/lib/domain-chain-lint.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { noteExecution } from "../client-cache/executions.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { NODE_KIND, nodeIn, type TGraph, type TGraphNode } from "../graph/types.js";
import { linkTo } from "../rpc-registry.js";
import { graphPresenterTag, mountGraphPresenter, presenterIn, type TGraphPresenter, type TPresenterNodeClick } from "../graph-presenter.js";

/** Where the chain's graph is placed in the view, which is also the test id it is found by, and the scope it keeps its
 *  settings under. */
const CHAIN_GRAPH = { slot: SHU_TEST_IDS.DOMAIN_CHAIN.GRAPH, scope: "domain-chain" } as const;

const StateSchema = z.object({
	loadState: z.enum(["idle", "fetching", "loaded", "empty"]).default("idle"),
	fetchError: z.string().default(""),
});

export class ShuDomainChainView extends ShuElement<typeof StateSchema> {
	/** What the embedded graph shows of the chain. */
	summarizeForKihan(): TLinkedData | null {
		if (!this.affordances) return null;
		return presenterIn(this, CHAIN_GRAPH.slot)?.summarizeForKihan() ?? null;
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

	private affordances: TAffordancesSnapshot | null = null;
	/** Test-only accessor; production reads happen inside `render()`. */
	getAffordances(): TAffordancesSnapshot | null {
		return this.affordances;
	}
	/** The chain as last projected, in which a node a reader opens is found. */
	private graph: TGraph | null = null;

	constructor() {
		super(StateSchema, { loadState: "idle", fetchError: "" });
	}

	protected override onConnected(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", SHU_TEST_IDS.DOMAIN_CHAIN.ROOT);
		if (this.affordances === null) void this.fetchInitial();
		// Batch the subscription: on reload the stream replays the whole `affordances.` history at once (thousands of
		// events), and a re-fetch per event pins the page. subscribeBatched collapses the replay to one re-fetch per frame.
		this.autoTeardown(
			this.subscribeBatched({
				// afterStep emits a lean change signal without a payload, so the view reads the snapshot again quietly, once per batch.
				onBatch: () => void this.fetchInitial(true),
				filter: (event: TEvent) => typeof event.id === "string" && (event.id as string).startsWith(AFFORDANCE_EVENT_PREFIX),
			}),
		);
		this.autoListen(this, SHU_EVENT.GRAPH_NODE_CLICK, (e) => this.onNodeClick(e));
		// The address names the goal or waypoint the reader is on, which the graph marks as its active node.
		this.autoTeardown(ViewHash.onHashChanged(() => presenterIn(this, CHAIN_GRAPH.slot)?.selectNode(this.addressedNode())));
	}

	/** View-open contract, pane-opener assigns producer products on mount. */
	set products(p: Record<string, unknown>) {
		// A chain lint report carries its findings beside the chain.
		this.findings = p.findings === undefined ? [] : z.array(LintFindingSchema).parse(p.findings);
		this.ingest(p);
	}

	/** A snapshot of the run's affordances, as a step's products or a read of them give it. Its facts are that run's, so
	 *  the actuality it names is the one the page reads, and a fact's step opens there. */
	private ingest(p: Record<string, unknown>): void {
		if (!Array.isArray(p.forward) || !Array.isArray(p.goals) || typeof p.execution !== "string") {
			throw new Error(`shu-domain-chain-view takes \`forward\` and \`goals\` arrays and the \`execution\` they are of. Received keys: [${Object.keys(p).join(", ")}].`);
		}
		this.affordances = {
			forward: p.forward as TAffordancesSnapshot["forward"],
			goals: p.goals as TAffordancesSnapshot["goals"],
			composites: p.composites as TAffordancesSnapshot["composites"],
			waypoints: Array.isArray(p.waypoints) ? (p.waypoints as TWaypointSnapshot[]) : undefined,
			satisfiedDomains: Array.isArray(p.satisfiedDomains) ? (p.satisfiedDomains as string[]) : undefined,
			satisfiedFacts: typeof p.satisfiedFacts === "object" && p.satisfiedFacts !== null ? (p.satisfiedFacts as Record<string, string[]>) : undefined,
		};
		noteExecution(p.execution);
		this.setState({ loadState: "loaded", fetchError: "" });
	}

	/** What a chain lint report found, when the view shows one. */
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
			case LINT_FINDING.STRING_PARAM:
				return html`${step(f.stepperName, f.stepName)} takes ${f.param} as ${domainRef(f.domain)}, which doesn't state what the value is`;
		}
	}

	private async fetchInitial(quiet = false): Promise<void> {
		// `quiet` (a live re-fetch on a change signal) skips the loadState transitions so the chain never flashes.
		if (!quiet) this.setState({ loadState: "fetching" });
		try {
			this.ingest(await conduit().follow<Record<string, unknown>>(linkTo(RPC_METHOD.AFFORDANCES_ON_OFFER), `domain-chain-view: ${RPC_METHOD.AFFORDANCES_ON_OFFER}`));
		} catch (err) {
			if (!quiet) this.setState({ loadState: "empty", fetchError: `RPC ${RPC_METHOD.AFFORDANCES_ON_OFFER} failed: ${errorDetail(err)}` });
		}
	}

	render(): TemplateResult {
		const { loadState, fetchError } = this.state;
		if (!this.affordances) {
			if (loadState === "fetching") return html`<shu-spinner visible status="Loading domain chain…"></shu-spinner>`;
			return html`
				${fetchError ? html`<div class="error" data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.ERROR}>${fetchError}</div>` : ""}
				<div class="empty" data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.EMPTY}>No chain data yet. Invoke <code>show affordances</code> from the actions bar (Step mode), or run any step.</div>
			`;
		}
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
					: html`<div class="empty">The site doesn't declare a graph view that draws the chain.</div>`
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
		const goal = ViewHash.hashParam(AFFORDANCE_PARAM.GOAL);
		const waypoint = ViewHash.hashParam(AFFORDANCE_PARAM.WAYPOINT);
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
		if (node.kind === NODE_KIND.factInstance && node.wasGeneratedBy?.factId) {
			openRef(this, "seqPath", { seqPath: producingStep(node.wasGeneratedBy.factId) });
			return;
		}
		// Every other node of the chain projection deep-links into the affordances panel.
		const addressed = deepLinkOf(node.link?.href ?? "");
		if (!addressed) throw new Error(`chain node ${node.id} doesn't have a deep link to open`);
		followDeepLink(this, addressed);
	}
}

defineElement(SHU_TAG.DOMAIN_CHAIN_VIEW, ShuDomainChainView);
