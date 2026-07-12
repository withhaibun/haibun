/**
 * <shu-type-column> — the column a `#Type` reference opens. Shows the type's description, a graph of its schema, and
 * the list of its individuals — each a reference that opens that individual's own column. When the site declares a
 * schema presenter (ui.presents === "schema", falling back to its general "graph" presenter), that presenter IS the
 * schema view, embedded through shu-product-view and scoped by focusType; the column publishes the type as the shared
 * selection, so the type's Class node highlights in every graph view. Without a presenter (standalone), a static SVG
 * shows the type's own schema, with a toggle widening it to the entire vocabulary. Read-only: the schema comes from
 * getTypeDescription/getRels/getEdgeRanges/getTypes, the instances from a bounded graphQuery.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { callStep } from "../pane-fetch.js";
import { appAccessLevel, idOf } from "../util.js";
import { getEdgeRanges, getRels, getTypeDescription, getTypes, getUiPresenting } from "../rels-cache.js";
import { renderRef } from "./shu-ref.js";
import { SHU_EVENT } from "../consts.js";
import { ONTOLOGY_CLASS } from "../graph/ontology-projection.js";
import type { TGraph } from "../graph/types.js";
import { ShuProductView } from "./shu-product-view.js";

const TypeColumnSchema = z.object({
	persistedAs: z.string().default(""),
	fullSchema: z.boolean().default(false),
	loading: z.boolean().default(false),
	error: z.string().optional(),
});

type VertexData = Record<string, unknown>;

/** Add one type's schema to a graph under construction: an outgoing edge per referenced type (getEdgeRanges) and a leaf
 *  per literal property (a rel that is not an edge). Property nodes are shared across types (`prop:` id) — a rel IS one
 *  Property, so two types declaring `name` point at the same node. Pure — derived entirely from concern metadata. */
function addTypeSchema(nodes: Map<string, TGraph["nodes"][number]>, edges: TGraph["edges"], persistedAs: string): void {
	const ranges = getEdgeRanges(persistedAs) ?? {};
	for (const [field, target] of Object.entries(ranges)) {
		if (!nodes.has(target)) nodes.set(target, { id: target, label: target });
		edges.push({ from: persistedAs, to: target, label: field, rel: field });
	}
	for (const field of Object.keys(getRels(persistedAs) ?? {})) {
		if (field in ranges) continue; // an edge to another type — already drawn
		const pid = `prop:${field}`;
		if (!nodes.has(pid)) nodes.set(pid, { id: pid, label: field, kind: "argument" });
		edges.push({ from: persistedAs, to: pid, label: field });
	}
}

/** The type's own schema graph: the type at the centre (highlighted), its referenced types, and its properties. */
export function buildTypeSchemaGraph(persistedAs: string): TGraph {
	const nodes = new Map<string, TGraph["nodes"][number]>([[persistedAs, { id: persistedAs, label: persistedAs, kind: "current" }]]);
	const edges: TGraph["edges"] = [];
	addTypeSchema(nodes, edges, persistedAs);
	return { nodes: [...nodes.values()], edges };
}

/** The ENTIRE schema — every declared type with its edges and properties — with the viewed type highlighted, so a
 *  reader sees where this type sits in the whole vocabulary. The same per-type builder as the local graph. */
export function buildFullSchemaGraph(current: string): TGraph {
	const nodes = new Map<string, TGraph["nodes"][number]>();
	const edges: TGraph["edges"] = [];
	for (const type of getTypes()) nodes.set(type, { id: type, label: type, ...(type === current ? { kind: "current" } : {}) });
	for (const type of getTypes()) addTypeSchema(nodes, edges, type);
	return { nodes: [...nodes.values()], edges };
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
			/* The graph fills all column height left by the header, description and instances, scrolling any excess within
			   its own box so it never paints over the Individuals list below it. */
			shu-graph, ::slotted(shu-product-view) { display: block; flex: 1 1 auto; min-height: 160px; overflow: auto; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.schema-scope { display: flex; align-items: center; gap: var(--shu-space-2); padding: var(--shu-space-1) var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
			.instances { flex: 0 0 auto; padding: var(--shu-space-3) var(--shu-space-4); }
			.section-label { display: block; font-size: var(--shu-font-sm); color: var(--shu-fg-muted); margin-bottom: var(--shu-space-2); }
			.instances ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--shu-space-1); }
			.error { color: var(--shu-error); }
		`,
	];

	/** The full-schema toggle is remembered across reloads, like every persisted view option. */
	static persistFields = ["fullSchema"] as const;

	private instances: VertexData[] = [];

	constructor() {
		super(TypeColumnSchema, { loading: true });
	}

	/** Called by the pane afterAttach hook with the referenced type. */
	async open(persistedAs: string): Promise<void> {
		// Surface the subject and publish it as the shared selection: in the ontology projection a Class node's id IS the
		// persistedAs, so every graph view (the embedded presenter and any open graph column) highlights this type's Class.
		this.setAttribute("data-subject", persistedAs);
		this.setState({ persistedAs, loading: true, error: undefined });
		// label is the SELECTED NODE'S graph — the type's Class node lives in the Class cluster, and a schema label
		// tells every consumer this subject is a schema term, not an individual to fetch.
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [{ s: persistedAs }], accessLevel: appAccessLevel(), label: ONTOLOGY_CLASS }, bubbles: true, composed: true }));
		// A referenced-but-undefined class — an upper-ontology superclass a type is a kind of (e.g. prov:Agent), reachable
		// via subClassOf but with no registered topology — has no queryable label and no instances. Show only its schema
		// position (its description, and the schema graph scoped to it), never a graphQuery that would fail "Unknown label".
		if (!getTypes().includes(persistedAs)) {
			this.instances = [];
			this.setState({ loading: false });
			return;
		}
		const res = await callStep<{ vertices: VertexData[]; total: number }>("graphQuery", { query: { label: persistedAs, accessLevel: appAccessLevel(), limit: 100 } }, `type-column: ${persistedAs}`);
		if (!res.ok) {
			this.setState({ loading: false, error: res.error });
			return;
		}
		this.instances = res.value.vertices ?? [];
		this.setState({ loading: false });
	}

	private onScopeChange = (e: Event): void => {
		this.setState({ fullSchema: (e.target as HTMLInputElement).checked });
	};

	/** The site's schema presenter (the class browser) if declared, else its general graph presenter. */
	private static schemaPresenter(): ReturnType<typeof getUiPresenting> {
		return getUiPresenting("schema") ?? getUiPresenting("graph");
	}

	/** Mount the embedded schema presenter once per type, as a LIGHT-DOM child projected through the shadow slot: the
	 *  presenter (an A-Frame scene) resolves its camera via document.querySelector, which a shadow root would hide —
	 *  mounted in shadow its scene boots but its graph never attaches. updated(): the slot exists only after render.
	 *  The pane's controls toggle (data-show-controls) propagates through the product view to the presenter, so the
	 *  presenter's own view settings gate on the same pane gear as every view's. */
	private embeddedGraphFor = "";
	protected updated(): void {
		const view = this.querySelector(":scope > shu-product-view") as ShuProductView | null;
		if (view) {
			if (this.showControls) view.setAttribute("data-show-controls", "");
			else view.removeAttribute("data-show-controls");
			view.refresh();
		}
		const type = this.state.persistedAs;
		const presenter = ShuTypeColumn.schemaPresenter();
		if (!presenter || !type || this.embeddedGraphFor === type) return;
		this.embeddedGraphFor = type;
		let mounted = view;
		if (!mounted) {
			mounted = new ShuProductView();
			mounted.setAttribute("data-testid", "type-schema-graph");
			if (this.showControls) mounted.setAttribute("data-show-controls", "");
			this.appendChild(mounted);
		}
		mounted.openProducts({ _type: presenter.type, focusType: type });
	}

	render(): TemplateResult {
		const type = this.state.persistedAs;
		const desc = getTypeDescription(type);
		// The site's declared schema presenter (scoped by focusType), projected from light DOM through the slot;
		// standalone falls back to the static SVG, rebuilt per render — a cheap pure projection of the metadata cache,
		// so no stored copy to fall stale.
		const graphView = ShuTypeColumn.schemaPresenter()
			? html`<slot></slot>`
			: html`
				<label class="schema-scope"><input type="checkbox" data-testid="type-schema-scope" .checked=${this.state.fullSchema} @change=${this.onScopeChange} /> entire schema</label>
				<shu-graph data-testid="type-schema-graph" .products=${{ graph: this.state.fullSchema ? buildFullSchemaGraph(type) : buildTypeSchemaGraph(type) }}></shu-graph>`;
		return html`
			<div class="type-header"><span class="type-name" data-testid="type-name">${type}</span></div>
			${desc ? html`<p class="type-desc" data-testid="type-description">${desc}</p>` : ""}
			${graphView}
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
