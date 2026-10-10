import { SHU_TEST_IDS } from "./domains/test-ids.js";
import { reportRefusedScripts } from "./refused-scripts.js";
import { appAccessLevel, defaultLabel, esc } from "./util.js";
import { DOCK_FOOTPRINT, INDEX_PANE_KEY, SHU_EVENT, SHU_ATTR, SHU_TAG } from "./domains/elements.js";
import { getHash, hashOf, hashWithColumns } from "./view-hash.js";
/**
 * Main SPA entry point. The layout uses shu-column-strip and shu-column-pane.
 * The query pane is sticky on the left. Additional columns scroll to the right.
 * Each pane is resizable and renders independently.
 */
import {
	hydrateFromDom,
	getHydratedViewHash,
	getAvailableSteps,
	hydratedCache,
	isOffline,
	deploymentAllowedWithoutDelegation,
	deploymentVerifiesDelegations,
	deploymentEmbedderOrigin,
	pageBuild,
} from "./rpc-registry.js";
import { openPageAuthority, pageMay, type TPageAuthority } from "./page-key.js";
import { DELEGATIONS_READ_METHOD, type TDelegations } from "@haibun/core/lib/authority-types.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";
import { ShuElement } from "./page/components/shu-element.js";
import { registerComponents } from "./component-registry.js";
import { conduit, reads, setConduit, LiveConduit } from "./hypermedia.js";
import { SSE_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { installShuTokens } from "./page/components/styles.js";
import { applyStoredTheme } from "./page/components/shu-theme-switch.js";
import { eventStream, setEventStream, LiveEventStream, SerializedEventStream, subscribeBatchedEvents } from "./event-stream.js";
import { followRunningTurns } from "./conversation.js";
import { askEmbedderToDelegate, receiveFromEmbedder } from "./embedder.js";
import { ensureUiComponentLoaded as sharedEnsureUiComponentLoaded } from "./external-components.js";
import { paneOpsFor } from "./page/derivations/affordances.js";
import { setActiveViewId } from "./quads-snapshot.js";
import { SCOPE, dispatchSubjectEvent, entryOf } from "./current-subject.js";
import { PageContextSchema, type TContextPattern } from "./schemas.js";
import { activePane, pageContext, stripPanes, timeCursor } from "./signals.js";
import { PaneState, PaneOpenSchema } from "./pane-state.js";
import { followPaneLink } from "./page/components/ref-navigation.js";
import type { ShuColumnStrip } from "./page/components/shu-column-strip.js";
import type { ShuEntityColumn } from "./page/components/shu-entity-column.js";
import type { ShuStepDefinition } from "./page/components/shu-step-definition.js";
import type { ShuActionColumn } from "./page/components/shu-action-column.js";
import type { ShuFilterColumn } from "./page/components/shu-filter-column.js";
import type { ShuGraphQuery } from "./page/components/shu-graph-query.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { reportFailure, reportToRun, type TClientLogLevel } from "./client-log.js";
import { observeLongFrames } from "./long-frames.js";
import { hydrateClientCache, viewsShown, readRunAt } from "./client-cache/index.js";

const LAYOUT_STYLE = `
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    /* the containing block for a docked pane. The pane overlays the columns above the page strip and doesn't take layout
       space. */
    position: relative;
  }
  .app-container > shu-column-strip {
    flex: 1;
    min-height: 0;
    /* PaneDock sets this footprint to the docked pane's closed height, so the columns end above the pane and not behind
       it. The open docked pane overlays the columns. The value is 0 when a pane isn't docked. */
    margin-bottom: var(${DOCK_FOOTPRINT}, 0px);
  }
  /* Results pane styles (inside query pane's light DOM .results-target) */
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

/** Copies the URL query string into the hash on initial load where the hash doesn't hold parameters (e.g. ?label=Researcher →
 *  #?label=Researcher). */
function seedHashFromQueryString(): void {
	const h = ShuElement.getHash();
	if (h && h.length > 2) return;
	const search = new URLSearchParams(location.search);
	if (search.size === 0) return;
	const hashParams = new URLSearchParams();
	for (const [key, value] of search) hashParams.set(key, value);
	ShuElement.pushHash(hashOf(hashParams));
}

/**
 * Opens the reader's authority. It holds the page's key and the delegations to that key. The page signs its call to the
 * deployment's delegation read with the key. The page doesn't read delegations from a deployment that doesn't verify
 * them. It then holds only the actions the deployment allows without a delegation.
 */
function openReaderAuthority(): Promise<TPageAuthority> {
	const read = deploymentVerifiesDelegations() ? () => conduit().follow<TDelegations>(reads(DELEGATIONS_READ_METHOD), "read what was delegated to this page") : undefined;
	return openPageAuthority(read, deploymentAllowedWithoutDelegation());
}

/** Renders the page's key and the steps to get a delegation to it. A page that may not read renders this in place of any
 *  view, since every view reads. */
function showPageKey(appRoot: HTMLElement, authority: TPageAuthority): void {
	const origin = esc(location.origin);
	appRoot.innerHTML = `<div style="padding:20px;max-width:48rem">
		<p>This page doesn't have access. Give the key below to the person who owns this actuality. They delegate to the key,
		for example by naming it in the actuality's configuration. Then reload this page.</p>
		<shu-page-key></shu-page-key>
		<p>This browser keeps the key for ${origin}. Clearing this site's data removes the key. A delegation to a removed key
		doesn't apply here.</p>
	</div>`;
	appRoot.querySelector(SHU_TAG.PAGE_KEY)?.setAttribute("controller", authority.controller);
}

const main = async (): Promise<void> => {
	// Reads whether the reader arrived with a hash before anything writes to the hash. An address that names views is the
	// reader's own arrangement, so two addresses show different views of one actuality. A reader whose address doesn't name
	// a view is shown actuality's own views.
	const arrivedWithAddress = getHash().length > 1;
	hydrateFromDom();
	// The embedding page at the deployment's embedder origin posts the page the reader has open and a delegation to shu's key.
	const embedder = window.parent !== window ? deploymentEmbedderOrigin() : undefined;
	if (embedder) receiveFromEmbedder(embedder);
	// Every page uses one conduit. A page that a server serves sends its calls to that server. A page that carries a run's
	// records doesn't reach a server. Each of its reads returns what the page holds. The conduit is installed before any
	// component is registered, since every component reads through the accessor and throws on first use without a conduit.
	setConduit(new LiveConduit(""));
	// A page that carries a run's records writes them into the client cache before anything reads actuality. Every view then
	// reads them through the same sources it uses with a server. The client cache returns each read.
	const carried = hydratedCache();
	if (carried) {
		setEventStream(new SerializedEventStream());
		await hydrateClientCache(carried);
		ShuElement.pushHash(getHydratedViewHash());
	} else {
		setEventStream(new LiveEventStream(SSE_ROUTE));
	}
	// Records the long frames of the page's main thread from the start, including the frames before this call.
	observeLongFrames();
	// Install the shared design tokens at document level so combobox dropdowns and other elements rendered into document.body resolve the same `--shu-…` variables that shadow-DOM components inherit.
	installShuTokens();
	applyStoredTheme();
	seedHashFromQueryString();
	await registerComponents();

	const appRoot = document.getElementById("shu-main");
	if (!appRoot) return;

	try {
		// The reader's authority is read first, since getAvailableSteps and every later call are signed with it.
		if (!carried) {
			const authority = await openReaderAuthority();
			if (embedder && deploymentVerifiesDelegations()) await askEmbedderToDelegate(embedder, authority.controller);
			if (!pageMay(readAction(Access.public))) {
				showPageKey(appRoot, authority);
				return;
			}
		}
		await getAvailableSteps();
	} catch (err) {
		if (!isOffline()) {
			// The failure shows the page's build. The build identifies a deployment that serves page code older than its source.
			const build = pageBuild();
			appRoot.innerHTML = `<div style="padding:20px;color:#c00;font-family:monospace"><strong>This page didn't start.</strong> ${esc(errorDetail(err))}${build ? `<div data-testid="${SHU_TEST_IDS.APP.PAGE_BUILD}">${esc(build)}</div>` : ""}</div>`;
			return;
		}
	}
	if (!carried) {
		// The event stream connects before anything reads actuality. The server sends events from the moment a page connects,
		// so a page that waited for its first view would lose the events actuality logged while the page booted. A page that
		// didn't reach a server connects too, so its stream reports that the server is down. The server refuses the stream to a
		// page that may not follow actuality. That page reads without following.
		eventStream().connect();
		followRunningTurns();
	}

	const apiBase = appRoot.getAttribute("data-api-base") || "/shu";

	if (!document.getElementById("graph-style")) {
		const style = document.createElement("style");
		style.id = "graph-style";
		style.textContent = LAYOUT_STYLE;
		document.head.appendChild(style);
	}

	const getStrip = () => appRoot.querySelector("shu-column-strip") as ShuColumnStrip | null;
	const getIndexPane = () => getStrip()?.panes.find((pane) => pane.dataset.columnKey === INDEX_PANE_KEY) ?? null;
	const getQuery = () => appRoot.querySelector("shu-graph-query") as ShuGraphQuery | null;
	/** Returns the view a pane shows. The query renders its results into the index pane from outside the pane, so the index
	 *  pane's view is the query. Every other pane's view is its first child element. */
	const viewOf = (pane: Element | undefined | null): Element | null => (pane && pane === getIndexPane() ? getQuery() : (pane?.firstElementChild ?? null));
	/** Returns the pane that shows a view: the index pane for the query, and the enclosing column pane for every other view. */
	const paneOf = (view: Element | null): Element | null => (view && view === getQuery() ? getIndexPane() : (view?.closest?.(SHU_TAG.COLUMN_PANE) ?? null));

	// A reader without an arrangement of their own is shown the views actuality has shown. viewsShown reads those views from
	// actuality's records. A page that carries a run's records reads them through the same function, so a report doesn't
	// need the views precomputed.
	const shown = arrivedWithAddress ? [] : await viewsShown();
	if (shown.length > 0) ShuElement.pushHash(hashWithColumns(shown));
	// A served page opens at the view hash its server set when actuality hasn't shown a view and the reader's address
	// doesn't name one. The monitor's page opens at the monitor and the executions this device holds.
	else if (!arrivedWithAddress && !carried && getHydratedViewHash()) ShuElement.pushHash(getHydratedViewHash());

	const reportBootDiagnostic = (level: TClientLogLevel, msg: string, attrs?: Record<string, unknown>): void => reportToRun(level, "shu-app-boot", msg, attrs);
	reportBootDiagnostic("debug", "shu-app boot reached the pane-open listeners");

	const reportClientLog = (level: TClientLogLevel, message: string, attributes?: Record<string, unknown>): void => reportToRun(level, "shu-app", message, attributes);

	/**
	 * Reports each external-component lifecycle `phase` as a structured event. An error-level event also holds
	 * `haibun.autonomic.event: "step.failure"` and exception attributes. An urakata tick failure holds the same attributes.
	 * A consumer's autonomic loop reads that event from any source, so a source doesn't need its own channel.
	 */
	const reportExternalComponent = (
		level: "debug" | "error" | "info" | "warn" | "error",
		phase: "lookup" | "fetch" | "register" | "mount" | "missing-ui" | "missing-script" | "fetch-failed" | "register-failed" | "mounted",
		component: string,
		extra: Record<string, unknown> = {},
	) => {
		const message = `external-component ${component}: ${phase}${extra.error ? `, ${String(extra.error)}` : ""}`;
		const attributes: Record<string, unknown> = { "haibun.shu.external-component.phase": phase, "haibun.shu.external-component.name": component, ...extra };
		if (level === "error") {
			attributes["haibun.autonomic.event"] = "step.failure";
			attributes["exception.type"] = "ExternalComponentFailure";
			attributes["exception.message"] = typeof extra.error === "string" ? extra.error : message;
		}
		reportClientLog(level, message, attributes);
	};

	// Activates the pane at `index` through PaneState. PaneState.setActivePane writes the paneId as the hash's `active`
	// value. The hash doesn't hold a numeric index, since fromHash can't resolve a number and falls back to the leftmost
	// pane.
	const activatePaneByIndex = (index: number) => {
		const paneId = getStrip()?.panes[index]?.dataset.columnKey;
		if (paneId) PaneState.setActivePane(paneId);
	};

	// Builds the strip and its query pane before the query component, so .results-target exists before the query component.
	// PaneState creates every other pane after PaneState.init below.
	appRoot.innerHTML = `
		<div class="app-container">
			<shu-column-strip>
				<shu-column-pane label="" column-type="query" closable="false" active data-column-key="${INDEX_PANE_KEY}">
					<div class="results-target" style="height:100%;overflow:hidden;"></div>
					<shu-index-summary slot="spine"></shu-index-summary>
				</shu-column-pane>
			</shu-column-strip>
			<shu-page-strip api-base="${apiBase}" testid-prefix="app-"></shu-page-strip>
			<shu-graph-query api-base="${apiBase}" label="${defaultLabel()}" sort-order="desc" results-target=".results-target"></shu-graph-query>
		</div>
	`;

	// --- Event listeners ---
	const eventsController = new AbortController();
	const { signal } = eventsController;

	appRoot.addEventListener(
		SHU_EVENT.PANE_DISMISS,
		((e: CustomEvent) => {
			const paneId = e.detail?.paneId;
			// PaneState.dismiss closes the pane and updates the address. A reader who has closed a view has an arrangement, so actuality's views don't replace it.
			if (typeof paneId === "string" && paneId !== "query") PaneState.dismiss(paneId);
		}) as EventListener,
		{ signal },
	);

	// A click on a pane link opens the linked pane beside the pane that holds the link. The listener uses the capture
	// phase, so it receives the click before any view under the link.
	appRoot.addEventListener("click", followPaneLink, { capture: true, signal });

	// A view in the other bundle opens a pane through this event, since that bundle's PaneState isn't the page's. A
	// malformed request throws and doesn't open a default pane. PaneState.requestFrom opens a Miller column. The panes
	// after the source pane are stale relative to the new selection, so it closes each one that isn't pinned or docked
	// before it requests the new pane. It keeps those panes when `addToSelection` is true. addsToSelection sets it for a
	// ctrl, shift or meta click.
	appRoot.addEventListener(
		SHU_EVENT.PANE_OPEN,
		((e: CustomEvent) => {
			const parsed = PaneOpenSchema.safeParse(e.detail);
			if (!parsed.success) throw new Error(`[shu] ${SHU_EVENT.PANE_OPEN}: invalid pane request: ${parsed.error.message}`);
			PaneState.requestFrom(e, parsed.data.pane, parsed.data.addToSelection);
		}) as EventListener,
		{ signal },
	);

	// Binds this app's diagnostic reporter to the shared loader in external-components.ts.
	const ensureUiComponentLoaded = (childTag: string): Promise<void> => sharedEnsureUiComponentLoaded(childTag, reportExternalComponent);

	// The end event of a completed step can hold hypermedia products. Each product with view markers opens a pane through
	// PaneState. A trace substep doesn't open a view (see pane-event-router). paneOpsFor keeps only the latest op per pane
	// in a batch.
	subscribeBatchedEvents({
		onBatch: (events) => {
			for (const op of paneOpsFor(events).values()) {
				if (op.op === "component") PaneState.request({ paneType: "component", tag: op.tag, label: op.label, data: op.data });
				else PaneState.request({ paneType: "views-picker", views: op.views, label: op.label });
			}
		},
	});

	// Only an explicit close (PaneState.dismiss) or a Miller-column replacement at the click origin (PaneState.requestFrom)
	// removes a pane. A change of results, a repeated query or the initial query on a reload doesn't remove panes. Removing
	// them would close the component panes restored from the URL as the first results arrive.

	// Column widths persist via the pane's own ShuElement.persistFields (keyed by data-column-key), so this file doesn't add a listener.

	/** Returns the strip's element for the active pane. */
	const activePaneElement = (): HTMLElement | undefined =>
		(getStrip()?.panes ?? []).find((p) => (p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE)) === activePane.get());
	const paneSubjectOf = (pane: Element | undefined | null): TContextPattern[] | null =>
		(viewOf(pane) as { paneSubject?(): TContextPattern[] | null } | null)?.paneSubject?.() ?? null;
	/** Dispatches the page scope's entry from the active pane. Moving to a pane that shows a subject activates that
	 *  subject. A change of columns updates the entry to the active pane's current subject. A pane that doesn't show a
	 *  subject doesn't activate one, so moving to a log beside a conversation keeps the active record. */
	const raiseActivePaneSubject = (type: "activate" | "update"): void => {
		const patterns = paneSubjectOf(activePaneElement());
		if (type === "activate" && patterns === null) return;
		dispatchSubjectEvent({ type, scope: SCOPE.page, entry: entryOf(patterns ?? [], appAccessLevel()) });
	};

	// A view's context becomes the page's context.
	appRoot.addEventListener(
		SHU_EVENT.CONTEXT_CHANGE,
		((e: CustomEvent) => {
			const context = PageContextSchema.parse(e.detail);
			pageContext.set(context);
			// Only a context from the active pane activates its subject. A context from another column doesn't change the
			// active subject.
			const statedBy = paneOf(e.target as Element | null);
			if (statedBy && statedBy === activePaneElement()) dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: entryOf(context.patterns, context.accessLevel) });
		}) as EventListener,
		{ signal },
	);

	// SYNC_AVAILABLE means the shown results are older than what actuality holds. The listener adds the has-sync class to
	// the result total. The has-sync rule in LAYOUT_STYLE marks that total with a pulse and a sync glyph.
	appRoot.addEventListener(
		SHU_EVENT.SYNC_AVAILABLE,
		(() => {
			appRoot.querySelector(".result-total")?.classList.add("has-sync");
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		"sync-request",
		(() => {
			const query = getQuery();
			if (query) {
				void query.loadMetadata?.();
				void query.executeQuery?.();
			}
			appRoot.querySelector(".result-total")?.classList.remove("has-sync");
		}) as EventListener,
		{ signal },
	);

	// The time cursor holds the moment of each read of actuality. A window holds a few thousand records, so it doesn't
	// hold a moment far from the newest records. This subscription reads actuality around each moment the cursor moves to,
	// so a reader sees the records at that moment and not the records of the window they left. A press on the rail, a click
	// on a row and a drag of the cursor each move the cursor, so each one reads actuality through this subscription.
	eventsController.signal.addEventListener(
		"abort",
		timeCursor.subscribe((at) => {
			void readRunAt(at).catch((err: unknown) => reportFailure("shu-app", "actuality could not be read at the moment the cursor names", err));
		}),
	);
	// A filter change from the actions bar or the page strip sets the query's filters.
	appRoot.addEventListener(
		SHU_EVENT.FILTER_CHANGE,
		((e: CustomEvent) => {
			const query = getQuery();
			query?.setFilters?.(e.detail || {});
			// A search the reader asked for sets `asked`. That search restores the index pane from its spine, whether the page
			// or the reader minimized the pane. The bar's restore of its own search at load doesn't set `asked`, so the index
			// pane stays as it is.
			if (e.detail?.asked) getIndexPane()?.setMinimized(false);
		}) as EventListener,
		{ signal },
	);

	// A click on a recorded search summary sets its viewQuery snapshot as the query's `products`. A control step's product
	// passes through the same setter. The setter validates the snapshot against ViewQueryControlSchema and applies its
	// type, text, filters, sort and access. The resulting context change updates the bar's controls.
	appRoot.addEventListener(
		SHU_EVENT.SEARCH_RESTORE,
		((e: CustomEvent) => {
			const query = getQuery();
			if (!query) throw new Error("search-restore: the app doesn't hold a shu-graph-query, so the search isn't restored");
			query.products = e.detail.query;
		}) as EventListener,
		{ signal },
	);

	// A breadcrumb-nav event activates the pane at its index. Index 0 also deselects the query's rows. The `activePane`
	// subscription below applies the change to the snapshot store and the page scope.
	appRoot.addEventListener(
		"breadcrumb-nav",
		((e: CustomEvent) => {
			const { index } = e.detail || {};
			if (index === 0) getQuery()?.deselectAll?.();
			activatePaneByIndex(index);
		}) as EventListener,
		{ signal },
	);

	// The `activePane` signal holds the active pane. The strip renders it. harvestChatViewLd and the page strip's breadcrumb
	// read it. onActivePaneChange sets the active view's column type as the snapshot store's activeViewId and activates the
	// page scope's subject.
	const onActivePaneChange = (): void => {
		const panes = getStrip()?.panes ?? [];
		const index = panes.findIndex((p) => (p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE)) === activePane.get());
		setActiveViewId(index >= 0 ? (panes[index]?.getAttribute(SHU_ATTR.COLUMN_TYPE) ?? null) : null);
		raiseActivePaneSubject("activate");
	};
	signal.addEventListener("abort", activePane.subscribe(onActivePaneChange));

	// A change of columns updates the page scope's entry from the active pane. PaneState writes the hash.
	signal.addEventListener(
		"abort",
		stripPanes.subscribe(() => raiseActivePaneSubject("update")),
	);

	// Activates the query pane on start. persistFields restores its width (data-column-key="query").
	const strip0 = getStrip();
	strip0?.activatePane(0);

	// PaneState writes the URL hash. It creates every pane except the query pane. Each afterAttach hook passes its variant's
	// data to the attached column component. A new pane variant needs a schema entry and one hook here.
	if (strip0) {
		PaneState.init(
			strip0,
			{
				ensureLoaded: (tag) => ensureUiComponentLoaded(tag),
				afterAttach: {
					entity: (d, child) => (child as ShuEntityColumn).open(d.id, d.persistedAs, d.selector),
					type: (d, child) => (child as import("./page/components/shu-type-column.js").ShuTypeColumn).open(d.persistedAs),
					"filter-eq": (d, child) => (child as ShuFilterColumn).openFiltered(d.predicate, d.value, d.persistedAs),
					"filter-prop": (d, child) => (child as ShuFilterColumn).openProperty(d.predicate, d.persistedAs),
					"filter-incoming": (d, child) => (child as ShuFilterColumn).openIncoming(d.subject, d.persistedAs),
					thread: (d, child) => (child as import("./page/components/shu-thread-column.js").ShuThreadColumn).open(d.persistedAs, d.subject),
					"step-detail": (d, child) => (child as HTMLElement & { open(s: number[]): Promise<void> }).open(d.seqPath),
					step: (d, child) => (child as ShuStepDefinition).open(d.method),
					action: (d, child) => (child as ShuActionColumn).open(d.action),
					"views-picker": (d, child) => (child as HTMLElement & { setViews(v: unknown[]): void }).setViews(d.views),
				},
			},
			[
				// The page always holds the actions bar pane. It docks along the bottom unless the address places it elsewhere.
				{ pane: { paneType: "component", tag: SHU_TAG.ACTIONS_BAR, label: "Actions", docked: true }, attributes: { "api-base": apiBase, "testid-prefix": "app-" } },
			],
		);
		// The boot markup holds the query column, so PaneState doesn't create it and doesn't set it active. This line sets
		// the query column active where `activePane` is still null, before PaneState reads the hash. A hash that describes
		// panes replaces the active pane. A hash that doesn't describe panes leaves the query column active, so `activePane`
		// isn't null.
		if (activePane.get() === null) activePane.set("query");
		PaneState.fromHash();
		// The index pane minimizes to its spine to give actuality's views room, since a reader shown them didn't ask for a
		// view. The spine still shows the current search. A reader who arrived with an arrangement of their own keeps the
		// index pane as they left it.
		if (shown.length > 0) {
			const index = getIndexPane();
			if (!index) throw new Error("the page started on actuality's views without an index pane to minimize: the app builds one at boot and doesn't remove it");
			index.setMinimized(true);
		}
	}
};

reportRefusedScripts();
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void main());
} else {
	void main();
}
