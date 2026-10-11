/**
 * <shu-type-column>: the column a `#Type` reference opens. Shows the type's description, a graph of its schema, and
 * its individuals in the shared result table, so a type's records read with their own fields and sort by the same
 * columns the query and filter views offer. When the site declares a
 * schema presenter (ui.presents === "schema", falling back to its general "graph" presenter), that presenter IS the
 * schema view, embedded through shu-product-view and scoped by focusType. Without a presenter (standalone), a static SVG
 * shows the type's own schema, with a toggle widening it to the entire vocabulary. Read-only: the schema comes from
 * getTypeDescription/getRels/getEdgeRanges/getTypes, the individuals from the graph query a page at a time.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { queryGraph, queryRead } from "../controllers/read-controller.js";
import { LoadController } from "../controllers/load-controller.js";
import type { TCallOutcome } from "../pipelines/call-step.js";
import "./shu-refusal.js";
import { getEdgeRanges, getQueryableFields, getRels, getTypeDescription, getTypes, getUiPresenting, isSystemSchemaType, refContext } from "../controllers/catalog-controller.js";
import { arrayWindowedSource, readWindowedSource, type WindowedSource } from "../../windowed-source.js";

/** How many of a type's individuals one read answers. The column lists every individual the type has, a page at a time
 *  as a reader reaches it, rather than the first page without a statement that the rest are there. */
const INSTANCES_PAGE = 100;

/** A `#Type` link resolves against the site's own declared types: the same test every ref surface uses. */
import type { ShuResultTable } from "./shu-result-table.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { findDomain, stepsJoining } from "../controllers/registry-controller.js";
import { stepRef } from "./shu-ref.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";

const IDS = SHU_TEST_IDS.TYPE_COLUMN;
import { deepLinkOf, followDeepLink, openRef, paneHref, refHref } from "./ref-navigation.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { aType, type TContextPattern } from "../../schemas.js";
import { NODE_KIND, type TGraph } from "../../graph/types.js";
import { ShuProductView } from "./shu-product-view.js";
import { appAccessLevel } from "../../view-query.js";
import { renderRefProse } from "../derivations/markdown.js";

const TypeColumnSchema = z.object({ persistedAs: z.string().default(""), fullSchema: z.boolean().default(false) });

type VertexData = Record<string, unknown>;

type TSchemaNode = TGraph["nodes"][number];

/** A type's node, linked to the type's view. */
const typeNode = (type: string, kind?: string): TSchemaNode => ({ id: type, label: type, ...(kind ? { kind } : {}), link: { href: refHref(REF_DENOTES.type, { domain: type }) } });

/** Add one type's schema to a graph under construction: an outgoing edge per referenced type (getEdgeRanges) and a leaf
 *  per literal property (a rel that is not an edge). Property nodes are shared across types (`prop:` id): a rel IS one
 *  Property, so two types declaring `name` point at the same node, linked to the records of the first type that adds it,
 *  ordered by the property. Pure, derived entirely from concern metadata. */
function addTypeSchema(nodes: Map<string, TSchemaNode>, edges: TGraph["edges"], persistedAs: string): void {
	const ranges = getEdgeRanges(persistedAs) ?? {};
	for (const [field, targets] of Object.entries(ranges))
		for (const target of targets) {
			if (!nodes.has(target)) nodes.set(target, typeNode(target));
			edges.push({ from: persistedAs, to: target, label: field, rel: field });
		}
	for (const field of Object.keys(getRels(persistedAs) ?? {})) {
		if (field in ranges) continue; // an edge to another type, already drawn
		const pid = `prop:${field}`;
		if (!nodes.has(pid)) nodes.set(pid, { id: pid, label: field, kind: NODE_KIND.argument, link: { href: paneHref({ paneType: "filter-prop", persistedAs, predicate: field }) } });
		edges.push({ from: persistedAs, to: pid, label: field });
	}
}

/** The type's own schema graph: the type at the centre (highlighted), its referenced types, and its properties. */
export function buildTypeSchemaGraph(persistedAs: string): TGraph {
	const nodes = new Map<string, TSchemaNode>([[persistedAs, typeNode(persistedAs, NODE_KIND.current)]]);
	const edges: TGraph["edges"] = [];
	addTypeSchema(nodes, edges, persistedAs);
	return { nodes: [...nodes.values()], edges };
}

/** The ENTIRE schema, every declared type with its edges and properties, with the viewed type highlighted, so a
 *  reader sees where this type sits in the whole vocabulary. The same per-type builder as the local graph. */
export function buildFullSchemaGraph(current: string): TGraph {
	const nodes = new Map<string, TSchemaNode>();
	const edges: TGraph["edges"] = [];
	for (const type of getTypes()) nodes.set(type, typeNode(type, type === current ? NODE_KIND.current : undefined));
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
			.joins { padding: 0 var(--shu-space-4); margin: var(--shu-space-2) 0; }
			.joins .section-label { display: inline; margin-right: var(--shu-space-2); }
			.section-label { display: block; font-size: var(--shu-font-sm); color: var(--shu-fg-muted); margin-bottom: var(--shu-space-2); }
			.instances ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--shu-space-1); }
		`,
	];

	/** The full-schema toggle is remembered across reloads, like every persisted view option. */
	static persistFields = ["fullSchema"] as const;

	/** What the column reads of the type's individuals: each page the reader reaches, read as the table reaches it. */
	#readInstances: () => Promise<TCallOutcome<WindowedSource<VertexData>>> = () => Promise.resolve({ ok: true, value: arrayWindowedSource<VertexData>([]) });
	readonly #instancesRead = new LoadController<WindowedSource<VertexData>>(this, () => this.#readInstances());

	/** The type's individuals the column holds, or an empty source before its read completes. */
	get #instances(): WindowedSource<VertexData> {
		const page = this.#instancesRead.page;
		return page === undefined ? arrayWindowedSource<VertexData>([]) : page;
	}

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
		super(TypeColumnSchema, {});
	}

	/** Called by the pane afterAttach hook with the referenced type. */
	async open(persistedAs: string): Promise<void> {
		// Surface the subject: in the ontology projection a Class node's id IS the persistedAs, so a graph view drawing
		// the schema can find this type by it. It is not published on the selection axis, which names a record the store
		// holds: a Class is a projection of the registry and isn't a record, and naming one there asks every reader of that
		// axis for a record of a type that does not exist.
		this.setState({ persistedAs });
		// An ask from here is about the type: its members. This column holds a type without an id, so `aType` is the
		// only thing it can show, and it doesn't offer a query-surface label, since a schema view doesn't have one to give.
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [aType(persistedAs)], accessLevel: appAccessLevel() }, bubbles: true, composed: true }));
		// The column doesn't list individuals: a referenced-but-undefined class (e.g. prov:Agent, reachable via subClassOf but without a
		// registered topology) doesn't have any and would fail a graphQuery with "Unknown label"; and a registered schema presenter
		// lists individuals in its own tab, so the column shows only the schema position (description + scoped schema graph).
		if (!getTypes().includes(persistedAs) || ShuTypeColumn.schemaPresenter() !== undefined) {
			this.#instancesRead.hold(arrayWindowedSource<VertexData>([]));
			return;
		}
		const of = { label: persistedAs, accessLevel: appAccessLevel() };
		this.#readInstances = async () => {
			const first = await queryRead({ ...of, limit: INSTANCES_PAGE });
			if (!first.ok) return first;
			return {
				ok: true,
				value: readWindowedSource<VertexData>({ size: INSTANCES_PAGE, read: (start, end) => queryGraph({ ...of, limit: end - start, offset: start }), held: first.value }),
			};
		};
		await this.#instancesRead.run();
	}

	private tableRef = createRef<ShuResultTable>();

	protected onConnected(): void {
		this.autoListen(this, SHU_EVENT.GRAPH_NODE_CLICK, this.onSchemaNodeClick);
	}

	/** A schema node opens the view its link addresses; a press on the graph's background doesn't open a view. */
	private onSchemaNodeClick = (e: Event): void => {
		const node = (e as CustomEvent<{ node: TSchemaNode | null }>).detail.node;
		if (!node) return;
		const addressed = deepLinkOf(node.link?.href ?? "");
		if (!addressed) throw new Error(`schema node ${node.id} doesn't address a view`);
		followDeepLink(e, addressed);
	};

	/** A row opens the individual it is, exactly as a row in the query or filter view does. */
	private onRowClick = (e: Event): void => {
		const { individualId, label, ctrlKey } = (e as CustomEvent).detail;
		if (individualId) openRef(e, REF_DENOTES.individual, { persistedAs: label || this.state.persistedAs, id: individualId }, ctrlKey);
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
		if (table && this.#instancesRead.completed) {
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
			mounted.setAttribute("data-testid", IDS.SCHEMA_GRAPH);
			if (this.showControls) mounted.setAttribute("data-show-controls", "");
			this.appendChild(mounted);
		}
		mounted.openProducts({ _type: presenter.type, focusType: type });
	}

	override paneSubject(): TContextPattern[] | null {
		return this.state.persistedAs ? [aType(this.state.persistedAs)] : null;
	}

	render(): TemplateResult {
		const type = this.state.persistedAs;
		const domain = findDomain(type);
		const desc = getTypeDescription(type) ?? domain?.description;
		// The site's declared schema presenter (scoped by focusType), projected from light DOM through the slot;
		// standalone falls back to the static SVG, rebuilt per render: a light pure projection of the metadata cache,
		// so it doesn't keep a stored copy that could fall stale.
		const hasPresenter = ShuTypeColumn.schemaPresenter() !== undefined;
		const persisted = getTypes().includes(type);
		const graphView = hasPresenter
			? html`<slot></slot>`
			: html`
				<label class="schema-scope"><input type="checkbox" data-testid=${IDS.SCHEMA_SCOPE} .checked=${this.state.fullSchema} @change=${this.onScopeChange} /> entire schema</label>
				<shu-graph data-testid=${IDS.SCHEMA_GRAPH} .products=${{ graph: this.state.fullSchema ? buildFullSchemaGraph(type) : buildTypeSchemaGraph(type) }}></shu-graph>`;
		return html`
			${desc ? html`<p class="type-desc" data-testid=${IDS.DESCRIPTION}>${unsafeHTML(renderRefProse(desc, refContext))}</p>` : ""}
			${isSystemSchemaType(type) ? html`<p class="system-schema-note" data-testid=${IDS.SYSTEM_SCHEMA}>A system schema, defined in haibun's own vocabulary.</p>` : ""}
			${domain?.values?.length ? html`<p class="joins" data-testid=${IDS.VALUES}><span class="section-label">Values</span> ${domain.values.map((value, i) => html`${i ? ", " : ""}<code>${value}</code>`)}</p>` : ""}
			${type ? this.renderJoins(type) : ""}
			${graphView}
			${
				hasPresenter || !persisted
					? ""
					: html`<div class="instances">
				<span class="section-label">Individuals${this.#instances.count() ? ` (${this.#instances.count()})` : ""}</span>
				${this.#instancesRead.render<TemplateResult | typeof nothing>({
					pending: () => html`<span>Loading…</span>`,
					running: () => html`<span>Loading…</span>`,
					completed: () => nothing,
					failed: (refusal) => html`<shu-refusal .refusal=${refusal} .readAgain=${() => void this.#instancesRead.run()}></shu-refusal>`,
				})}
				<shu-result-table ${ref(this.tableRef)} data-testid=${IDS.INSTANCES} @row-click=${this.onRowClick}></shu-result-table>
			</div>`
			}`;
	}

	/** The steps that return this domain and the steps that take it, each a link to the step. */
	private renderJoins(type: string): TemplateResult {
		const { returning, taking } = stepsJoining(type);
		const steps = (label: string, joined: TStepDefinition[], testId: string) =>
			joined.length
				? html`<p class="joins" data-testid=${testId}><span class="section-label">${label}</span> ${joined.map((step, i) => html`${i ? ", " : ""}${stepRef(step.method)}`)}</p>`
				: "";
		return html`${steps("Returned by", returning, IDS.RETURNED_BY)}${steps("Taken by", taking, IDS.TAKEN_BY)}`;
	}
}

defineElement(SHU_TAG.TYPE_COLUMN, ShuTypeColumn);
