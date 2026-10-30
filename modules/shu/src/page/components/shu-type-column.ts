/**
 * <shu-type-column>: the column a `#Type` reference opens. Shows the type's description, its schema, and its individuals
 * in the shared result table, so a type's records read with their own fields and sort by the same columns the query and
 * filter views offer. When the site declares a schema presenter (ui.presents === "schema", falling back to its general
 * "graph" presenter), that presenter IS the schema view, embedded through shu-product-view and scoped by focusType. A page
 * without the presenter shows the type's description, its joins and its individuals, without a schema graph (CA3D8).
 * Read-only: the schema comes from the catalog, the individuals from the graph query a page at a time.
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
import { loadRenders } from "./load-renders.js";
import { getQueryableFields, getTypeDescription, getTypes, getUiPresenting, isSystemSchemaType, refContext } from "../controllers/catalog-controller.js";
import { arrayWindowedSource, readWindowedSource, unmarked, type WindowedSource } from "../derivations/windowed-source.js";

/** How many of a type's individuals one read returns. The column lists every individual the type has, a page at a time
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
import { openRef, paneHref } from "./ref-navigation.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { aType, type TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { ShuProductView } from "./shu-product-view.js";
import { appAccessLevel } from "../controllers/view-query-controller.js";
import { renderRefProse } from "../derivations/markdown.js";
import "./shu-result-table.js";

const TypeColumnSchema = z.object({ persistedAs: z.string() });

type VertexData = Record<string, unknown>;

export class ShuTypeColumn extends ShuElement<typeof TypeColumnSchema> {
	/** The type and its individuals: an rdfs:Class with its description and the instances currently listed. */
	summarizeForContext(): TLinkedData | null {
		const type = this.state.persistedAs;
		if (!type) return null;
		const description = getTypeDescription(type);
		return { "@id": type, "@type": "rdfs:Class", name: type, ...(description ? { description } : {}), instanceCount: this.#instances.count(), instances: this.#read() };
	}

	static styles = [
		shuBaseStyles,
		// The presenter fills all column height left by the header and description, scrolling any excess within its own box.
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
			.type-desc { padding: var(--shu-space-3) var(--shu-space-4); margin: 0; color: var(--shu-fg-muted); }
			.system-schema-note { padding: 0 var(--shu-space-4) var(--shu-space-2); margin: 0; color: var(--shu-fg-faded); font-size: 0.85em; font-style: italic; }
			::slotted(shu-product-view) { display: block; flex: 1 1 auto; min-height: 160px; overflow: auto; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.instances { flex: 0 0 auto; padding: var(--shu-space-3) var(--shu-space-4); }
			.joins { padding: 0 var(--shu-space-4); margin: var(--shu-space-2) 0; }
			.joins .section-label { display: inline; margin-right: var(--shu-space-2); }
			.section-label { display: block; font-size: var(--shu-font-sm); color: var(--shu-fg-muted); margin-bottom: var(--shu-space-2); }
			.instances ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--shu-space-1); }
		`,
	];

	/** What the column reads of the type's individuals: each page the reader reaches, read as the table reaches it. */
	#readInstances: () => Promise<TCallOutcome<WindowedSource<VertexData>>> = () => Promise.resolve({ ok: true, value: arrayWindowedSource<VertexData>([], []) });
	readonly #instancesRead = new LoadController<WindowedSource<VertexData>>(this, () => this.#readInstances());

	/** The type's individuals the column holds, or an empty source before its read completes. */
	get #instances(): WindowedSource<VertexData> {
		const page = this.#instancesRead.page;
		return page === undefined ? arrayWindowedSource<VertexData>([], []) : page;
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
		super(TypeColumnSchema, { persistedAs: "" });
	}

	/** Called by the pane afterAttach hook with the referenced type. */
	async open(persistedAs: string): Promise<void> {
		// Surface the subject: in the ontology projection a Class node's id IS the persistedAs, so a graph view drawing
		// the schema can find this type by it. It is not published on the selection axis, which names a record the store
		// holds: a Class is a projection of the registry and isn't a record, and naming one there sends every reader of that
		// axis a request for a record of a type that does not exist.
		this.setState({ persistedAs });
		// An ask from here is about the type: its members. This column holds a type without an id, so `aType` is the
		// only thing it can show, and it doesn't offer a query-surface label, since a schema view doesn't have one to give.
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [aType(persistedAs)], readLevel: appAccessLevel() }, bubbles: true, composed: true }));
		// The column doesn't list individuals: a referenced-but-undefined class (e.g. prov:Agent, reachable via subClassOf but without a
		// registered topology) doesn't have any and would fail a graphQuery with "Unknown label"; and a registered schema presenter
		// lists individuals in its own tab, so the column shows only the schema position (description + scoped schema graph).
		if (!getTypes().includes(persistedAs) || ShuTypeColumn.schemaPresenter() !== undefined) {
			this.#instancesRead.hold(arrayWindowedSource<VertexData>([], []));
			return;
		}
		const of = { label: persistedAs, accessLevel: appAccessLevel() };
		this.#readInstances = async () => {
			const first = await queryRead({ ...of, limit: INSTANCES_PAGE, offset: 0 });
			if (!first.ok) return first;
			const read = (start: number, end: number) => queryGraph({ ...of, limit: end - start, offset: start });
			return { ok: true, value: readWindowedSource<VertexData>({ size: INSTANCES_PAGE, read, held: first.value, from: 0, markers: unmarked }) };
		};
		await this.#instancesRead.run();
	}

	private tableRef = createRef<ShuResultTable>();

	/** A row opens the individual it is, exactly as a row in the query or filter view does. */
	private onRowClick = (e: Event): void => {
		const { individualId, label, ctrlKey } = (e as CustomEvent).detail;
		if (individualId) openRef(e, { kind: REF_DENOTES.individual, target: { persistedAs: label || this.state.persistedAs, id: individualId } }, ctrlKey);
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
			table.collection = paneHref({ paneType: "type", persistedAs: this.state.persistedAs });
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
		// The site's declared schema presenter (scoped by focusType), projected from light DOM through the slot.
		const hasPresenter = ShuTypeColumn.schemaPresenter() !== undefined;
		const persisted = getTypes().includes(type);
		const graphView = hasPresenter ? html`<slot></slot>` : nothing;
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
					...loadRenders(html`Reading the records of ${type}`, this.#instancesRead),
					completed: () => html`<shu-result-table ${ref(this.tableRef)} data-testid=${IDS.INSTANCES} @row-click=${this.onRowClick}></shu-result-table>`,
				})}
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
