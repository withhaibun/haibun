/**
 * <shu-type-column>: the column a `#Type` reference opens. Shows the type's description, a graph of its schema, and
 * its individuals in the shared result table, so a type's records read with their own fields and sort by the same
 * columns the query and filter views offer. When the site declares a
 * schema presenter (ui.presents === "schema", falling back to its general "graph" presenter), that presenter IS the
 * schema view, embedded through shu-product-view and scoped by focusType; the column publishes the type as the shared
 * selection, so the type's Class node highlights in every graph view. Without a presenter (standalone), a static SVG
 * shows the type's own schema, with a toggle widening it to the entire vocabulary. Read-only: the schema comes from
 * getTypeDescription/getRels/getEdgeRanges/getTypes, the individuals from the graph query a page at a time.
 */
import { html, css, type TemplateResult } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { QueryController } from "../controllers/query-controller.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { appAccessLevel } from "../util.js";
import { getEdgeRanges, getQueryableFields, getRels, getTypeDescription, getTypes, getUiPresenting, isSystemSchemaType } from "../rels-cache.js";
import { renderRefProse } from "../markdown-refs.js";
import { arrayWindowedSource, readWindowedSource, type WindowedSource } from "../windowed-source.js";

/** How many of a type's individuals one read answers. The column lists every individual the type has, a page at a time
 *  as a reader reaches it, rather than the first page with nothing to say the rest are there. */
const INSTANCES_PAGE = 100;

/** A `#Type` link resolves against the site's own declared types: the same test every ref surface uses. */
const isKnownType = (name: string): boolean => getRels(name) !== undefined;
import type { ShuResultTable } from "./shu-result-table.js";
import { SHU_EVENT } from "../consts.js";
import { aboutType } from "../schemas.js";
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
 *  per literal property (a rel that is not an edge). Property nodes are shared across types (`prop:` id): a rel IS one
 *  Property, so two types declaring `name` point at the same node. Pure, derived entirely from concern metadata. */
function addTypeSchema(nodes: Map<string, TGraph["nodes"][number]>, edges: TGraph["edges"], persistedAs: string): void {
	const ranges = getEdgeRanges(persistedAs) ?? {};
	for (const [field, target] of Object.entries(ranges)) {
		if (!nodes.has(target)) nodes.set(target, { id: target, label: target });
		edges.push({ from: persistedAs, to: target, label: field, rel: field });
	}
	for (const field of Object.keys(getRels(persistedAs) ?? {})) {
		if (field in ranges) continue; // an edge to another type, already drawn
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

/** The ENTIRE schema, every declared type with its edges and properties, with the viewed type highlighted, so a
 *  reader sees where this type sits in the whole vocabulary. The same per-type builder as the local graph. */
export function buildFullSchemaGraph(current: string): TGraph {
	const nodes = new Map<string, TGraph["nodes"][number]>();
	const edges: TGraph["edges"] = [];
	for (const type of getTypes()) nodes.set(type, { id: type, label: type, ...(type === current ? { kind: "current" } : {}) });
	for (const type of getTypes()) addTypeSchema(nodes, edges, type);
	return { nodes: [...nodes.values()], edges };
}

export class ShuTypeColumn extends ShuElement<typeof TypeColumnSchema> {
	/** The type and its individuals: an rdfs:Class with its description and the instances currently listed. */
	summarizeForKihan(): TLinkedData | null {
		const type = this.state.persistedAs;
		if (!type) return null;
		const description = getTypeDescription(type);
		return { "@id": type, "@type": "rdfs:Class", name: type, ...(description ? { description } : {}), instanceCount: this.#instances.count(), instances: this.#read() };
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
			.type-desc { padding: var(--shu-space-3) var(--shu-space-4); margin: 0; color: var(--shu-fg-muted); }
			.system-schema-note { padding: 0 var(--shu-space-4) var(--shu-space-2); margin: 0; color: var(--shu-fg-faded); font-size: 0.85em; font-style: italic; }
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

	#instances: WindowedSource<VertexData> = arrayWindowedSource<VertexData>([]);

	/** The individuals read so far: the page the column read, and whatever a reader has scrolled to since. */
	#read(): VertexData[] {
		const rows: VertexData[] = [];
		for (let i = 0; i < this.#instances.count(); i++) {
			const row = this.#instances.rowAt(i);
			if (row !== undefined) rows.push(row);
		}
		return rows;
	}

	constructor() {
		super(TypeColumnSchema, { loading: true });
	}

	/** Called by the pane afterAttach hook with the referenced type. */
	async open(persistedAs: string): Promise<void> {
		// Surface the subject: in the ontology projection a Class node's id IS the persistedAs, so a graph view drawing
		// the schema can find this type by it. It is not published on the selection axis, which names a record the store
		// holds: a Class is a projection of the registry and no record, and naming one there asks every reader of that
		// axis for a record of a type that does not exist.
		this.setAttribute("data-subject", persistedAs);
		this.setState({ persistedAs, loading: true, error: undefined });
		// An ask from here is about the type: its members. This column holds a type and no id, so `aboutType` is the
		// only thing it can say, and no query-surface label is offered, since a schema view has none to give.
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
				detail: { patterns: [aboutType(persistedAs)], accessLevel: appAccessLevel() },
				bubbles: true,
				composed: true,
			}),
		);
		// No individuals to list: a referenced-but-undefined class (e.g. prov:Agent, reachable via subClassOf but with no
		// registered topology) has none and would fail a graphQuery with "Unknown label"; and a registered schema presenter
		// lists individuals in its own tab, so the column shows only the schema position (description + scoped schema graph).
		if (!getTypes().includes(persistedAs) || ShuTypeColumn.schemaPresenter() !== undefined) {
			this.#instances = arrayWindowedSource<VertexData>([]);
			this.setState({ loading: false });
			return;
		}
		try {
			const of = { label: persistedAs, accessLevel: appAccessLevel() };
			const first = await this.#query.run({ ...of, limit: INSTANCES_PAGE });
			this.#instances = readWindowedSource<VertexData>({
				total: () => first.total,
				size: INSTANCES_PAGE,
				read: async (start, end) => ((await this.#query.run({ ...of, limit: end - start, offset: start })).vertices ?? []) as VertexData[],
				held: (first.vertices ?? []) as VertexData[],
			});
		} catch (err) {
			this.setState({ loading: false, error: errorDetail(err) });
			return;
		}
		this.setState({ loading: false });
	}

	/** The view holds its data access, as every migrated column does, rather than calling the wire itself. */
	#query = new QueryController(this);

	private tableRef = createRef<ShuResultTable>();

	/** A row opens the individual it is, exactly as a row in the query or filter view does. */
	private onRowClick = (e: Event): void => {
		const { individualId, label, ctrlKey } = (e as CustomEvent).detail;
		if (!individualId) return;
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
				detail: { subject: individualId, label: label || this.state.persistedAs, addToSelection: ctrlKey },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onScopeChange = (e: Event): void => {
		this.setState({ fullSchema: (e.target as HTMLInputElement).checked });
	};

	/** The site's schema presenter (the class browser) if declared, else its general graph presenter. */
	private static schemaPresenter(): ReturnType<typeof getUiPresenting> {
		return getUiPresenting("schema") ?? getUiPresenting("graph");
	}

	/** Mount the embedded schema presenter once per type, as a LIGHT-DOM child projected through the shadow slot: the
	 *  presenter (an A-Frame scene) resolves its camera via document.querySelector, which a shadow root would hide:
	 *  mounted in shadow its scene boots but its graph never attaches. updated(): the slot exists only after render.
	 *  The pane's controls toggle (data-show-controls) propagates through the product view to the presenter, so the
	 *  presenter's own view settings gate on the same pane gear as every view's. */
	private embeddedGraphFor = "";
	protected updated(): void {
		const table = this.tableRef.value;
		if (table && !this.state.loading && !this.state.error) {
			table.persistedAs = this.state.persistedAs;
			table.setSortableFields(getQueryableFields(this.state.persistedAs));
			table.setSource(this.#instances as WindowedSource<Record<string, unknown>>);
		}
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
		// standalone falls back to the static SVG, rebuilt per render: a light pure projection of the metadata cache,
		// so no stored copy to fall stale.
		const hasPresenter = ShuTypeColumn.schemaPresenter() !== undefined;
		const graphView = hasPresenter
			? html`<slot></slot>`
			: html`
				<label class="schema-scope"><input type="checkbox" data-testid="type-schema-scope" .checked=${this.state.fullSchema} @change=${this.onScopeChange} /> entire schema</label>
				<shu-graph data-testid="type-schema-graph" .products=${{ graph: this.state.fullSchema ? buildFullSchemaGraph(type) : buildTypeSchemaGraph(type) }}></shu-graph>`;
		return html`
			${desc ? html`<p class="type-desc" data-testid="type-description">${unsafeHTML(renderRefProse(desc, isKnownType))}</p>` : ""}
			${isSystemSchemaType(type) ? html`<p class="system-schema-note" data-testid="type-system-schema">A system schema, defined in haibun's own vocabulary.</p>` : ""}
			${graphView}
			${
				hasPresenter
					? ""
					: html`<div class="instances">
				<span class="section-label">Individuals${this.#instances.count() ? ` (${this.#instances.count()})` : ""}</span>
				${this.state.loading ? html`<span>Loading…</span>` : ""}
				${this.state.error ? html`<div class="error" data-testid="type-error">${this.state.error}</div>` : ""}
				<shu-result-table ${ref(this.tableRef)} data-testid="type-instances" @row-click=${this.onRowClick}></shu-result-table>
			</div>`
			}`;
	}
}
