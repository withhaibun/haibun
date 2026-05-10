/**
 * ShuDomainChainView — visualizes the typed step graph as Mermaid.
 *
 * Subscribes to the affordances SSE event for the latest graph snapshot, then
 * renders domains as nodes and steps as labeled edges. Each domain node carries
 * its key. Each step edge shows the step's gwta or stepper.stepName. Capability-
 * gated steps are styled distinctly. Steps with no inputs originate from a single
 * sentinel "∅" source node.
 *
 * This is the type-centric view. A step-centric (bipartite) variant can be added
 * later; the data is the same.
 */
import mermaid from "mermaid";
import { sanitizeId } from "../mermaid-source.js";
import { esc } from "../util.js";

type TForwardAffordance = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	readyToRun: boolean;
	capability?: string;
};

type TAffordances = {
	forward: TForwardAffordance[];
	goals: Array<{ domain: string; resolution: { finding: string } }>;
};

const SOURCE_DOMAIN = "∅";

let mermaidInitialized = false;

export class ShuDomainChainView extends HTMLElement {
	private affordances: TAffordances | null = null;
	private unsubscribe: (() => void) | null = null;
	private renderId = 0;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		const handler = (e: Event) => {
			const detail = (e as CustomEvent<TAffordances>).detail;
			if (detail) {
				this.affordances = detail;
				void this.renderComponent();
			}
		};
		document.addEventListener("shu:affordances", handler);
		this.unsubscribe = () => document.removeEventListener("shu:affordances", handler);
		void this.renderComponent();
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Allow programmatic update without SSE for tests and explicit pushes. */
	setAffordances(a: TAffordances): void {
		this.affordances = a;
		void this.renderComponent();
	}

	private buildMermaidSource(a: TAffordances): string {
		const domains = new Set<string>();
		let hasSource = false;
		for (const f of a.forward) {
			for (const d of f.inputDomains) domains.add(d);
			for (const d of f.outputDomains) domains.add(d);
			if (f.inputDomains.length === 0 && f.outputDomains.length > 0) hasSource = true;
		}
		if (hasSource) domains.add(SOURCE_DOMAIN);

		const goalFindings = new Map<string, string>();
		for (const g of a.goals) goalFindings.set(g.domain, g.resolution.finding);

		const lines: string[] = ["graph LR"];

		for (const d of domains) {
			const id = sanitizeId(d);
			const label = d === SOURCE_DOMAIN ? "∅<br/>(no preconditions)" : esc(d);
			lines.push(`  ${id}["${label}"]`);
			const finding = goalFindings.get(d);
			if (finding === "satisfied") lines.push(`  style ${id} fill:#d8edd8,stroke:#1a6b3c,stroke-width:2px`);
			else if (finding === "plan") lines.push(`  style ${id} fill:#d8e1f0,stroke:#2848a8`);
			else if (finding === "unreachable") lines.push(`  style ${id} fill:#fdd,stroke:#a02828`);
			else if (finding === "refused") lines.push(`  style ${id} fill:#fde6c4,stroke:#b58105`);
			else lines.push(`  style ${id} fill:#eee,stroke:#999`);
		}

		for (const f of a.forward) {
			const label = (f.gwta ?? `${f.stepperName}.${f.stepName}`) + (f.capability ? " ⚷" : "");
			const escapedLabel = label.replace(/"/g, "'");
			const ins = f.inputDomains.length === 0 ? [SOURCE_DOMAIN] : f.inputDomains;
			for (const from of ins) {
				for (const to of f.outputDomains) {
					const fromId = sanitizeId(from);
					const toId = sanitizeId(to);
					const arrow = f.readyToRun ? "==>" : "-->";
					lines.push(`  ${fromId} ${arrow}|"${escapedLabel}"| ${toId}`);
				}
			}
		}

		return lines.join("\n");
	}

	private async renderComponent(): Promise<void> {
		if (!this.shadowRoot) return;
		const a = this.affordances;
		if (!a) {
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="empty">No domain-chain data yet — run a step to populate.</div>`;
			return;
		}

		const source = this.buildMermaidSource(a);
		const headerHtml = `
			<div class="header">
				<h3>Domain chain</h3>
				<div class="controls">
					<button data-action="copy" title="Copy Mermaid source to clipboard">Copy</button>
				</div>
			</div>
			<details class="explanation">
				<summary>How to read this</summary>
				<p>Each node is a registered domain. Each edge is a step that consumes its source domain(s) and produces its target domain. Bold (==>) edges are ready-to-run now; dashed (-->) edges have unsatisfied preconditions. ⚷ marks capability-gated steps. Node colours show the goal-resolver's verdict for that domain: green = satisfied (a fact exists), blue = plan (a chain reaches it), red = unreachable, amber = refused.</p>
			</details>
		`;

		if (!mermaidInitialized) {
			mermaid.initialize({
				startOnLoad: false,
				theme: "default",
				securityLevel: "loose",
				fontFamily: "ui-sans-serif, system-ui, sans-serif",
				maxTextSize: 1_000_000,
				maxEdges: 5000,
				flowchart: { htmlLabels: true },
			});
			mermaidInitialized = true;
		}

		const id = `domain-chain-${++this.renderId}`;
		try {
			const { svg } = await mermaid.render(id, source);
			this.shadowRoot.innerHTML = `<style>${STYLES}</style>${headerHtml}<div class="graph">${svg}</div>`;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.shadowRoot.innerHTML = `<style>${STYLES}</style>${headerHtml}<div class="graph"><div class="error">mermaid render failed: ${esc(msg)}</div><pre class="source-fallback">${esc(source)}</pre></div>`;
		}

		this.bindActions(source);
	}

	private bindActions(source: string): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.querySelector('button[data-action="copy"]')?.addEventListener("click", () => {
			void navigator.clipboard.writeText(source);
		});
	}
}

const STYLES = `
	:host { display: block; padding: 12px; font-family: inherit; }
	.header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
	.header h3 { margin: 0; font-size: 13px; color: #444; }
	.controls button { padding: 3px 8px; font-size: 11px; background: #fafafa; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; }
	.controls button:hover { background: #eee; }
	.explanation summary { cursor: pointer; font-size: 12px; color: #555; padding: 4px 0; }
	.explanation p { margin: 4px 0; font-size: 12px; color: #333; }
	.graph { padding: 8px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; overflow: auto; }
	.source-fallback { padding: 8px; font-family: monospace; font-size: 11px; white-space: pre; color: #444; }
	.error { color: #a02828; padding: 6px; background: #fdecec; border-radius: 3px; margin-bottom: 4px; font-size: 12px; }
	.empty { color: #888; font-style: italic; font-size: 12px; }
`;
