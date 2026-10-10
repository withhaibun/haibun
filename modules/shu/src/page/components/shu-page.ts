/**
 * <shu-page>: the page a reader opens. Once the page opens on actuality, it holds the strip of panes with the index pane
 * on the left, the page strip, and the query, and it routes what its views report: a pane opened, closed or followed, the
 * context a view states, a filter, a restored search and a move of the time cursor. Where the reader may not read, it shows
 * the page's key and how to get a delegation to it; where the page didn't open, it shows why and the build of its code.
 *
 * Light DOM: the query renders its results into the index pane from outside the pane, and the strip's panes find each
 * other through the document.
 */
import { html, type TemplateResult } from "lit";
import { DOCK_FOOTPRINT, INDEX_PANE_KEY, SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";
import { defineElement, loadComponent } from "../controllers/element-controller.js";
import { activePane, pageContext, stripPanes, timeCursor } from "../controllers/page-cell-controller.js";
import { paneOpsFor } from "../derivations/affordances.js";
import { BreadcrumbNavSchema, FilterChangeSchema } from "../domains/page-state.js";
import type { TPageOpening } from "../pipelines/open-page.js";
import { followPaneLink } from "./ref-navigation.js";
import { PANE_ATTACH, PaneState, PaneOpenSchema } from "../../pane-state.js";
import { SCOPE, dispatchSubjectEvent, entryOf, entryOfContext } from "../../current-subject.js";
import { PageContextSchema, type TContextPattern } from "../../schemas.js";
import { setActiveViewId } from "../../quads-snapshot.js";
import { readRunAt } from "../../client-cache/index.js";
import { reportFailure } from "../../client-log.js";
import { appAccessLevel, defaultLabel } from "../../util.js";
import type { ShuColumnStrip } from "./shu-column-strip.js";
import type { ShuGraphQuery } from "./shu-graph-query.js";

const LAYOUT_STYLE = `
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    /* the containing block for a docked pane, which overlays the columns above the page strip and doesn't take layout space. */
    position: relative;
  }
  .app-container > shu-column-strip {
    flex: 1;
    min-height: 0;
    /* PaneDock sets this footprint to the docked pane's closed height, so the columns end above the pane. It is 0 where a
       pane isn't docked. */
    margin-bottom: var(${DOCK_FOOTPRINT}, 0px);
  }
  .results-pane { display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative; }
  .results-pane .error-banner {
    padding: 4px 6px; margin: 8px 6px 4px; background: #fdd; border: 1px solid #c00;
    color: #900; white-space: pre-wrap; border-radius: 3px;
  }
  .results-pane .loading-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 2;
    background: linear-gradient(90deg, transparent, #666, transparent);
    background-size: 200% 100%;
    animation: shu-slide 1s linear infinite;
    pointer-events: none;
  }
  @keyframes shu-slide { to { background-position: -200% 0; } }
  .results-pane .result-total.has-sync {
    color: #1a6b3c; font-weight: 700; pointer-events: auto; cursor: pointer;
    animation: sync-pulse 2s ease-in-out infinite;
  }
  .results-pane .result-total.has-sync::after { content: " \\27F3"; }
  @keyframes sync-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
`;

/** The id of the page's layout stylesheet in the document. */
const LAYOUT_STYLE_ID = "shu-page-layout";

/** The label of the actions bar's pane, which the page always holds, docked along the bottom unless the address places it. */
const ACTIONS_LABEL = "Actions";

export class ShuPage extends ShuElement<typeof EmptyStateSchema> {
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptyStateSchema;
	static domainSelector = SHU_TAG.PAGE;

	/** How the page opened, which the page's start sets before it mounts the page. */
	opening: TPageOpening | undefined = undefined;
	/** The path the site serves its routes under. */
	apiBase: string | undefined = undefined;

	constructor() {
		super(EmptyStateSchema);
	}

	createRenderRoot(): HTMLElement {
		return this;
	}

	#opening(): TPageOpening {
		if (this.opening === undefined) throw new Error("<shu-page> is mounted after the page's start sets how the page opened");
		return this.opening;
	}

	#apiBase(): string {
		if (this.apiBase === undefined) throw new Error("<shu-page> is mounted after the page's start sets the path the site serves its routes under");
		return this.apiBase;
	}

	/** Returns the page's strip of panes. Throws before the page renders it. */
	#strip(): ShuColumnStrip {
		const strip = this.querySelector<ShuColumnStrip>(SHU_TAG.COLUMN_STRIP);
		if (strip === null) throw new Error("<shu-page> reads its strip of panes after it renders it");
		return strip;
	}
	#indexPane = () => this.#strip().panes.find((pane) => pane.dataset.columnKey === INDEX_PANE_KEY) ?? null;
	#query = (): ShuGraphQuery | null => this.querySelector<ShuGraphQuery>(SHU_TAG.GRAPH_QUERY);
	/** Returns the view a pane shows: the query for the index pane, into which it renders its results, and the first child of
	 *  each other pane. */
	#viewOf = (pane: Element | undefined | null): Element | null => (pane && pane === this.#indexPane() ? this.#query() : (pane?.firstElementChild ?? null));
	/** Returns the pane that shows a view: the index pane for the query, and the enclosing column pane for each other view. */
	#paneOf = (view: Element | null): Element | null => (view && view === this.#query() ? this.#indexPane() : (view?.closest?.(SHU_TAG.COLUMN_PANE) ?? null));
	/** Returns the strip's element for the active pane. */
	#activePaneElement = (): HTMLElement | undefined => this.#strip().panes.find((p) => (p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE)) === activePane.get());

	/** Dispatches the page scope's entry from the active pane. A move to a pane that shows a subject activates the subject, and
	 *  a change of columns updates the entry to the active pane's subject. A pane that doesn't show a subject doesn't activate
	 *  one, so a move to a log beside a conversation keeps the active record. */
	#raiseActivePaneSubject(type: "activate" | "update"): void {
		const patterns = (this.#viewOf(this.#activePaneElement()) as { paneSubject?(): TContextPattern[] | null } | null)?.paneSubject?.() ?? null;
		if (patterns === null) {
			// A change of columns to a pane that doesn't show a subject empties the page scope's entry.
			if (type === "update") dispatchSubjectEvent({ type, scope: SCOPE.page, entry: entryOf([], appAccessLevel()) });
			return;
		}
		dispatchSubjectEvent({ type, scope: SCOPE.page, entry: entryOf(patterns, appAccessLevel()) });
	}

	protected override onConnected(): void {
		const opening = this.#opening();
		if (opening.status !== "opened") return;
		// The layout styles the document's elements, as the page renders into light DOM, so it is a stylesheet of the document.
		if (document.getElementById(LAYOUT_STYLE_ID) === null) {
			const style = document.createElement("style");
			style.id = LAYOUT_STYLE_ID;
			style.textContent = LAYOUT_STYLE;
			document.head.appendChild(style);
		}
		// Each listener ends with the page: a pane opened, closed or followed, a context a view states, a filter, a restored
		// search, a move of the time cursor and of the active pane.
		this.autoListen(this, SHU_EVENT.PANE_DISMISS, ((e: CustomEvent) => {
			const paneId = e.detail?.paneId;
			if (typeof paneId === "string" && paneId !== INDEX_PANE_KEY) PaneState.dismiss(paneId);
		}) as EventListener);
		// A click on a pane link opens the linked pane beside the pane that holds it, in the capture phase, before a view under
		// the link receives the click.
		this.autoListen(this, "click", followPaneLink as EventListener, { capture: true });
		// A view in another bundle opens a pane through this event, since that bundle's PaneState isn't the page's.
		this.autoListen(this, SHU_EVENT.PANE_OPEN, ((e: CustomEvent) => {
			const parsed = PaneOpenSchema.safeParse(e.detail);
			if (!parsed.success) throw new Error(`[shu] ${SHU_EVENT.PANE_OPEN}: invalid pane request: ${parsed.error.message}`);
			PaneState.requestFrom(e, parsed.data.pane, parsed.data.addToSelection);
		}) as EventListener);
		// A completed step's products with view markers open a pane each, the latest operation per pane in a batch.
		this.autoTeardown(
			this.subscribeBatched({
				onBatch: (events) => {
					for (const op of paneOpsFor(events).values()) {
						if (op.op === "component") PaneState.request({ paneType: "component", tag: op.tag, label: op.label, data: op.data });
						else PaneState.request({ paneType: "views-picker", views: op.views, label: op.label });
					}
				},
			}),
		);
		// A view's context becomes the page's context, and a context from the active pane activates its subject.
		this.autoListen(this, SHU_EVENT.CONTEXT_CHANGE, ((e: CustomEvent) => {
			const context = PageContextSchema.parse(e.detail);
			pageContext.set(context);
			const statedBy = this.#paneOf(e.target as Element | null);
			if (statedBy && statedBy === this.#activePaneElement()) dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: entryOfContext(context) });
		}) as EventListener);
		// The shown results are older than what actuality holds: the result total pulses with a sync glyph until a read again.
		this.autoListen(this, SHU_EVENT.SYNC_AVAILABLE, () => this.querySelector(".result-total")?.classList.add("has-sync"));
		this.autoListen(this, "sync-request", () => {
			const query = this.#query();
			if (query) {
				void query.loadMetadata?.();
				void query.executeQuery?.();
			}
			this.querySelector(".result-total")?.classList.remove("has-sync");
		});
		// The time cursor holds the moment of each read of actuality. A window holds a few thousand records, so the page reads
		// actuality around each moment the cursor names.
		this.autoTeardown(timeCursor.subscribe((at) => void readRunAt(at).catch((err: unknown) => reportFailure(SHU_TAG.PAGE, "actuality could not be read at the moment the cursor names", err))));
		this.autoListen(this, SHU_EVENT.FILTER_CHANGE, ((e: CustomEvent) => {
			const { asked, ...filters } = FilterChangeSchema.parse(e.detail);
			this.#query()?.setFilters?.(filters);
			// A search the reader asked for restores the index pane from its spine; the bar's restore of its own search at load
			// leaves the pane as it is.
			if (asked) this.#indexPane()?.setMinimized(false);
		}) as EventListener);
		this.autoListen(this, SHU_EVENT.SEARCH_RESTORE, ((e: CustomEvent) => {
			const query = this.#query();
			if (!query) throw new Error("search-restore: the page doesn't hold a shu-graph-query, so the search isn't restored");
			query.products = e.detail.query;
		}) as EventListener);
		// A breadcrumb activates the pane at its index, and index 0 also deselects the query's rows.
		this.autoListen(this, "breadcrumb-nav", ((e: CustomEvent) => {
			const { index } = BreadcrumbNavSchema.parse(e.detail);
			if (index === 0) this.#query()?.deselectAll?.();
			const paneId = this.#strip().panes[index]?.dataset.columnKey;
			if (paneId) PaneState.setActivePane(paneId);
		}) as EventListener);
		// The active pane's column type is the snapshot store's active view, and its subject is the page scope's.
		this.autoTeardown(
			activePane.subscribe(() => {
				const { panes } = this.#strip();
				const index = panes.findIndex((p) => (p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE)) === activePane.get());
				setActiveViewId(index >= 0 ? (panes[index]?.getAttribute(SHU_ATTR.COLUMN_TYPE) ?? null) : null);
				this.#raiseActivePaneSubject("activate");
			}),
		);
		this.autoTeardown(stripPanes.subscribe(() => this.#raiseActivePaneSubject("update")));
		void this.updateComplete.then(() => this.#openPanes(opening.shown));
	}

	/** Opens the panes the address names, beside the index pane the page renders. */
	#openPanes(shown: string[]): void {
		const strip = this.#strip();
		strip.activatePane(0);
		const apiBase = this.#apiBase();
		PaneState.init(
			strip,
			{
				ensureLoaded: (tag) => loadComponent(tag),
				afterAttach: PANE_ATTACH,
			},
			[{ pane: { paneType: "component", tag: SHU_TAG.ACTIONS_BAR, label: ACTIONS_LABEL, docked: true }, attributes: { "api-base": apiBase, "testid-prefix": "app-" } }],
		);
		// The page renders the index pane, so PaneState doesn't create it or set it active. A hash that names panes replaces
		// the active pane; one that doesn't leaves the index pane active.
		if (activePane.get() === null) activePane.set(INDEX_PANE_KEY);
		PaneState.fromHash();
		// The index pane minimizes to its spine to give actuality's views room, since a reader shown them didn't ask for a view.
		if (shown.length > 0) {
			const index = this.#indexPane();
			if (!index) throw new Error("the page opened on actuality's views without an index pane to minimize");
			index.setMinimized(true);
		}
	}

	render(): TemplateResult {
		const opening = this.#opening();
		if (opening.status === "keyed")
			return html`<div style="padding:20px;max-width:48rem">
				<p>This page doesn't have access. Give the key below to the person who owns this actuality. They delegate to the key, for example by naming it in the
				actuality's configuration. Then reload this page.</p>
				<shu-page-key controller=${opening.controller}></shu-page-key>
				<p>This browser keeps the key for ${location.origin}. Clearing this site's data removes the key. A delegation to a removed key doesn't apply here.</p>
			</div>`;
		if (opening.status === "failed")
			return html`<div style="padding:20px;color:#c00;font-family:monospace">
				<strong>This page didn't start.</strong> ${opening.reason}
				<div data-testid=${SHU_TEST_IDS.APP.PAGE_BUILD}>${opening.build}</div>
			</div>`;
		const apiBase = this.#apiBase();
		return html`<div class="app-container">
				<shu-column-strip>
					<shu-column-pane label="" column-type="query" closable="false" active data-column-key=${INDEX_PANE_KEY}>
						<div class="results-target" style="height:100%;overflow:hidden;"></div>
						<shu-index-summary slot="spine"></shu-index-summary>
					</shu-column-pane>
				</shu-column-strip>
				<shu-page-strip api-base=${apiBase} testid-prefix="app-"></shu-page-strip>
				<shu-graph-query api-base=${apiBase} label=${defaultLabel()} sort-order="desc" results-target=".results-target"></shu-graph-query>
			</div>`;
	}
}

defineElement(SHU_TAG.PAGE, ShuPage);
