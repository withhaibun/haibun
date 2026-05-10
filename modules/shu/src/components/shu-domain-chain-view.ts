/**
 * ShuDomainChainView — visualizes the typed step graph as Mermaid.
 *
 * Subscribes to the affordances SSE event to get the latest graph snapshot, then
 * renders domains as nodes and steps as labeled edges. Each domain node carries
 * its key. Each step edge shows the step's gwta or stepper.stepName. Capability-
 * gated steps are styled distinctly. Steps with no inputs originate from a single
 * sentinel "∅" source node.
 *
 * This is the type-centric view. A step-centric (bipartite) variant can be added
 * later; the data is the same.
 */
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

declare global {
	interface Window {
		mermaid?: {
			render(id: string, source: string): Promise<{ svg: string }>;
			initialize(config: unknown): void;
		};
	}
}

const SOURCE_DOMAIN = "∅";

export class ShuDomainChainView extends HTMLElement {
	private affordances: TAffordances | null = null;
	private unsubscribe: (() => void) | null = null;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		// Listen on the document event channel that the affordances panel publishes
		// to. To avoid two SSE subscribers competing, this component listens to a
		// custom event on the document instead; the affordances panel re-emits its
		// snapshot when it gets one.
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
		// Collect every domain referenced as either a step input or output. Plus the
		// sentinel SOURCE_DOMAIN if any step has no inputs.
		const domains = new Set<string>();
		let hasSource = false;
		for (const f of a.forward) {
			for (const d of f.inputDomains) domains.add(d);
			for (const d of f.outputDomains) domains.add(d);
			if (f.inputDomains.length === 0 && f.outputDomains.length > 0) hasSource = true;
		}
		if (hasSource) domains.add(SOURCE_DOMAIN);

		// Goal verdicts give per-domain finding for styling.
		const goalFindings = new Map<string, string>();
		for (const g of a.goals) goalFindings.set(g.domain, g.resolution.finding);

		const lines: string[] = ["graph LR"];

		// Nodes
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

		// Edges — one per (step, input-domain, output-domain) triple.
		for (const f of a.forward) {
			const label = (f.gwta ?? `${f.stepperName}.${f.stepName}`) + (f.capability ? ` ⚷` : "");
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
			this.shadowRoot.innerHTML =
				'<div class="empty">No domain-chain data yet — run a step to populate.</div><style>:host{display:block;padding:12px}.empty{color:#888;font-style:italic;font-size:12px}</style>';
			return;
		}

		const source = this.buildMermaidSource(a);
		const headerHtml = `
			<div class="header">
				<h3>Domain chain</h3>
				<details>
					<summary>How to read this</summary>
					<p>Each node is a registered domain. Each edge is a step that consumes its source domain(s) and produces its target domain. Bold (==>) edges are ready-to-run now; dashed (-->) edges have unsatisfied preconditions. ⚷ marks capability-gated steps. Node colours show the goal-resolver's verdict for that domain: green = satisfied (a fact exists), blue = plan (a chain reaches it), red = unreachable, amber = refused.</p>
				</details>
			</div>
		`;

		const styles = `
			:host { display: block; padding: 12px; font-family: -apple-system, system-ui, sans-serif; }
			.header h3 { margin: 0 0 4px; font-size: 13px; color: #444; text-transform: uppercase; letter-spacing: 0.04em; }
			.header summary { cursor: pointer; font-size: 12px; color: #555; padding: 4px 0; }
			.header p { margin: 4px 0; font-size: 12px; color: #333; }
			.graph { padding: 8px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; overflow: auto; }
			.source-fallback { padding: 8px; font-family: monospace; font-size: 11px; white-space: pre; color: #444; }
		`;

		if (typeof window !== "undefined" && window.mermaid) {
			try {
				const id = `domain-chain-${Date.now()}`;
				const { svg } = await window.mermaid.render(id, source);
				this.shadowRoot.innerHTML = `<style>${styles}</style>${headerHtml}<div class="graph">${svg}</div>`;
				return;
			} catch (err) {
				// Render the raw mermaid source when the renderer throws — the user
				// still sees what we tried to draw, and can read the structure directly.
				const msg = err instanceof Error ? err.message : String(err);
				this.shadowRoot.innerHTML = `<style>${styles}</style>${headerHtml}<div class="graph"><div class="error">mermaid render failed: ${esc(msg)}</div><pre class="source-fallback">${esc(source)}</pre></div>`;
				return;
			}
		}
		// No mermaid available — show the source so the user can still read it.
		this.shadowRoot.innerHTML = `<style>${styles}</style>${headerHtml}<div class="graph"><pre class="source-fallback">${esc(source)}</pre></div>`;
	}
}
