/**
 * ShuDomainChainView — type-centric chain visualization.
 *
 * Subscribes to the latest affordances snapshot from the goal-resolver and
 * delegates rendering to `shu-graph` after projecting the snapshot into a
 * renderer-agnostic `TGraph`. Domains become nodes (coloured by goal finding)
 * and steps become labeled edges (bold when ready, dashed when blocked,
 * dotted when capability-gated).
 *
 * A step-centric (bipartite) variant can be added later by swapping in a
 * different projection function; the data is the same.
 */
import { SseClient, inAction } from "../sse-client.js";
import { projectDomainChain, type TAffordancesSnapshot } from "../graph/project-domain-chain.js";
import { buildMermaidSource } from "../graph/mermaid-renderer.js";

type TLoadState = "idle" | "fetching" | "loaded" | "empty";

export class ShuDomainChainView extends HTMLElement {
	private affordances: TAffordancesSnapshot | null = null;
	private loadState: TLoadState = "idle";

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", "shu-domain-chain");
		this.renderComponent();
		if (this.affordances === null) void this.fetchInitial();
	}

	/**
	 * View-open contract: `pane-opener` assigns this property with the producing step's
	 * products (e.g. `show chain lint`'s `{findings, summary, forward, goals, ...}`).
	 * The chain graph renders from `forward` + `goals`; absence of those fields throws
	 * — the producing step must supply chain data, no fallbacks.
	 */
	set products(p: Record<string, unknown>) {
		if (!Array.isArray(p.forward) || !Array.isArray(p.goals)) {
			throw new Error(
				`shu-domain-chain-view requires products with \`forward\` and \`goals\` arrays. Received keys: [${Object.keys(p).join(", ")}]. The step's productsDomain schema must include forward+goals; the action must populate them.`,
			);
		}
		this.affordances = { forward: p.forward as TAffordancesSnapshot["forward"], goals: p.goals as TAffordancesSnapshot["goals"] };
		this.loadState = "loaded";
		this.renderComponent();
	}

	private async fetchInitial(): Promise<void> {
		this.loadState = "fetching";
		this.renderComponent();
		try {
			const sse = SseClient.for("");
			const response = await inAction((scope) => sse.rpc<Record<string, unknown>>(scope, "GoalResolutionStepper-showAffordances", {}));
			if (Array.isArray(response?.forward) && Array.isArray(response?.goals)) {
				this.affordances = { forward: response.forward as TAffordancesSnapshot["forward"], goals: response.goals as TAffordancesSnapshot["goals"] };
				this.loadState = "loaded";
				this.renderComponent();
				return;
			}
			this.loadState = "empty";
			this.renderComponent();
		} catch {
			this.loadState = "empty";
			this.renderComponent();
		}
	}

	private renderComponent(): void {
		if (!this.shadowRoot) return;
		const a = this.affordances;
		if (!a) {
			if (this.loadState === "fetching") {
				this.shadowRoot.innerHTML = `<style>${STYLES}</style><shu-spinner visible status="Loading domain chain…"></shu-spinner>`;
				return;
			}
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="empty" data-testid="domain-chain-empty">No chain data yet. Invoke <code>show chain lint</code> from the actions bar (Step mode), or run any step — every step end emits a chain snapshot.</div>`;
			return;
		}

		const graph = projectDomainChain(a);
		const mermaidSource = buildMermaidSource(graph);
		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			<div class="header">
				<h3>Domain chain</h3>
				<shu-copy-button label="Copy" title="Copy Mermaid source to clipboard"></shu-copy-button>
			</div>
			<details class="explanation">
				<summary>How to read this</summary>
				<p>Each node is a registered domain. Each edge is a step that consumes its source domain(s) and produces its target domain. Bold (==>) edges are ready-to-run now; dashed (-->) edges have unsatisfied preconditions. Dotted (-.->) edges are capability-gated. Node colours show the goal-resolver's verdict for that domain: green = satisfied (a fact exists), blue = reachable (a path reaches it), red = unreachable, amber = refused.</p>
			</details>
			<shu-graph data-testid="domain-chain-graph"></shu-graph>
		`;
		const graphEl = this.shadowRoot.querySelector("shu-graph") as (HTMLElement & { products: Record<string, unknown> }) | null;
		if (graphEl) graphEl.products = { graph };
		const copy = this.shadowRoot.querySelector("shu-copy-button") as (HTMLElement & { source: string }) | null;
		if (copy) copy.source = mermaidSource;
	}
}

const STYLES = `
	:host { display: block; padding: 12px; font-family: inherit; }
	.header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
	.header h3 { margin: 0; font-size: 13px; color: #444; }
	.explanation summary { cursor: pointer; font-size: 12px; color: #555; padding: 4px 0; }
	.explanation p { margin: 4px 0; font-size: 12px; color: #333; }
	.empty { color: #555; font-size: 12px; padding: 12px; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 4px; }
	.empty code { background: #eee; padding: 1px 4px; border-radius: 2px; font-size: 11px; }
`;
