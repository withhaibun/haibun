/**
 * <shu-type-column> — the column a `#Type` reference opens. Shows the type's description, a visual graph of its
 * schema (the type at the centre, an edge to each type it references and a leaf per literal property, all from the
 * client's concern metadata), and the list of its individuals — each a reference that opens that individual's own
 * column. Read-only: the schema comes from getTypeDescription/getRels/getEdgeRanges, the instances from a bounded
 * graphQuery.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { callStep } from "../pane-fetch.js";
import { appAccessLevel, idOf } from "../util.js";
import { getEdgeRanges, getRels, getTypeDescription } from "../rels-cache.js";
import { renderRef } from "./shu-ref.js";
import type { TGraph } from "../graph/types.js";

const TypeColumnSchema = z.object({
	persistedAs: z.string().default(""),
	loading: z.boolean().default(false),
	error: z.string().optional(),
});

type VertexData = Record<string, unknown>;

/**
 * The type's schema graph: the type at the centre, an outgoing edge to each type it references (getEdgeRanges),
 * and a leaf node per literal property (a rel that is not an edge). Pure — derived entirely from concern metadata.
 */
export function buildTypeSchemaGraph(persistedAs: string): TGraph {
	const nodes: TGraph["nodes"] = [{ id: persistedAs, label: persistedAs, kind: "current" }];
	const edges: TGraph["edges"] = [];
	const seen = new Set<string>([persistedAs]);
	const ranges = getEdgeRanges(persistedAs) ?? {};
	for (const [field, target] of Object.entries(ranges)) {
		if (!seen.has(target)) {
			nodes.push({ id: target, label: target });
			seen.add(target);
		}
		edges.push({ from: persistedAs, to: target, label: field, rel: field });
	}
	for (const field of Object.keys(getRels(persistedAs) ?? {})) {
		if (field in ranges) continue; // an edge to another type — already drawn
		const pid = `prop:${field}`;
		nodes.push({ id: pid, label: field, kind: "argument" });
		edges.push({ from: persistedAs, to: pid, label: field });
	}
	return { nodes, edges };
}

/** The label to show for an instance in the list: a human field if present, else its id. */
function instanceLabel(v: VertexData): string {
	const id = idOf(v);
	return String(v.name ?? v.subject ?? v.email ?? v.filename ?? id);
}

export class ShuTypeColumn extends ShuElement<typeof TypeColumnSchema> {
	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
			.type-header { padding: var(--shu-space-3) var(--shu-space-4); border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.type-name { font-size: var(--shu-font-lg); font-weight: 700; }
			.type-desc { padding: var(--shu-space-2) var(--shu-space-4); margin: 0; color: var(--shu-fg-muted); }
			shu-graph { display: block; flex: 0 0 auto; height: 240px; min-height: 0; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.instances { padding: var(--shu-space-3) var(--shu-space-4); }
			.section-label { display: block; font-size: var(--shu-font-sm); color: var(--shu-fg-muted); margin-bottom: var(--shu-space-2); }
			.instances ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--shu-space-1); }
			.error { color: var(--shu-error); }
		`,
	];

	private instances: VertexData[] = [];
	private graph: TGraph = { nodes: [], edges: [] };

	constructor() {
		super(TypeColumnSchema, { loading: true });
	}

	/** Called by the pane afterAttach hook with the referenced type. */
	async open(persistedAs: string): Promise<void> {
		this.graph = buildTypeSchemaGraph(persistedAs);
		this.setState({ persistedAs, loading: true, error: undefined });
		const res = await callStep<{ vertices: VertexData[]; total: number }>("graphQuery", { query: { label: persistedAs, accessLevel: appAccessLevel(), limit: 100 } }, `type-column: ${persistedAs}`);
		if (!res.ok) {
			this.setState({ loading: false, error: res.error });
			return;
		}
		this.instances = res.value.vertices ?? [];
		this.setState({ loading: false });
	}

	render(): TemplateResult {
		const type = this.state.persistedAs;
		const desc = getTypeDescription(type);
		return html`
			<div class="type-header"><span class="type-name" data-testid="type-name">${type}</span></div>
			${desc ? html`<p class="type-desc" data-testid="type-description">${desc}</p>` : ""}
			<shu-graph data-testid="type-schema-graph" .products=${{ graph: this.graph }}></shu-graph>
			<div class="instances">
				<span class="section-label">Individuals${this.instances.length ? ` (${this.instances.length})` : ""}</span>
				${this.state.loading ? html`<span>Loading…</span>` : ""}
				${this.state.error ? html`<div class="error" data-testid="type-error">${this.state.error}</div>` : ""}
				<ul data-testid="type-instances">
					${this.instances.map((v) => html`<li>${unsafeHTML(renderRef("entity", { persistedAs: type, id: idOf(v) }, instanceLabel(v)))}</li>`)}
				</ul>
			</div>`;
	}
}
