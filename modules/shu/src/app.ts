import { defaultLabel } from "./util.js";
import { INDEX_PANE_KEY, SHU_EVENT, SHU_ATTR } from "./consts.js";
import { getHash, hashWithColumns } from "./view-hash.js";
/**
 * Main SPA entry point — uses shu-column-strip + shu-column-pane layout.
 * Query pane is sticky on the left, additional columns scroll right.
 * Each pane is resizable and independently rendered.
 */
import { hydrateFromDom, getHydratedViewHash, getAvailableSteps, findStep, hydratedCache, isOffline } from "./rpc-registry.js";
import { openSession } from "./session-key.js";
import { Access } from "@haibun/core/lib/resources.js";
import { ShuElement } from "./components/shu-element.js";
import { registerComponents } from "./component-registry.js";
import { conduit, setConduit, LiveConduit } from "./hypermedia.js";
import { installShuTokens } from "./components/styles.js";
import { applyShuPreferences } from "./components/shu-theme-switch.js";
import { setEventStream, LiveEventStream, SerializedEventStream, subscribeBatchedEvents } from "./event-stream.js";
import { ensureUiComponentLoaded as sharedEnsureUiComponentLoaded } from "./external-components.js";
import { paneOpsFor } from "./pane-event-router.js";
import { setActiveViewId, setSelectedSubject, getViewContext, selectionFromContext } from "./quads-snapshot.js";
import { activePane, timeCursor } from "./signals.js";
import { PaneState, DesiredPaneSchema } from "./pane-state.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";
import type { ShuEntityColumn } from "./components/shu-entity-column.js";
import type { ShuFilterColumn } from "./components/shu-filter-column.js";
import type { ShuActionsBar } from "./components/shu-actions-bar.js";
import type { ShuGraphQuery } from "./components/shu-graph-query.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { reportToRun, type TClientLogLevel } from "./client-log.js";
import { hydrateClientCache, viewsShown, readRunAt } from "./client-cache/index.js";

const LAYOUT_STYLE = `
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    /* positioning context for the actions bar, which overlays the bottom rather than taking layout space */
    position: relative;
    /* reserve the closed actions bar's footprint (published by shu-actions-bar) so the column strip ends above it,
       never behind it; the expanded bar still floats over content transiently. 0 when no bar is mounted. */
    padding-bottom: var(--shu-actions-bar-h, 0px);
  }
  .app-container > shu-column-strip {
    flex: 1;
    min-height: 0;
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

/** Seed hash state from URL query string on initial load (e.g. ?label=Researcher → #?label=Researcher). */
function seedHashFromQueryString(): void {
	const h = ShuElement.getHash();
	if (h && h.length > 2) return;
	const search = new URLSearchParams(location.search);
	if (search.size === 0) return;
	const hashParams = new URLSearchParams();
	for (const [key, value] of search) hashParams.set(key, value);
	ShuElement.pushHash(`#?${hashParams.toString()}`);
}

/**
 * What this reader may do, if the deployment offers a way to be given anything. The page makes a key it keeps to
 * itself, presents the public half, and holds what comes back; every call needing authority is then signed with that
 * key. A deployment offering no such step gives its readers nothing, and they act with nothing, which is a deployment
 * where nothing a reader can reach requires authority.
 *
 * Started, not waited for. Nothing the page first renders acts under a session, and a reader browsing what needs no
 * authority is not kept waiting for one; a call that does need it waits (rpcHeaders), and fails there with why.
 */
function openReaderSession(): void {
	const issuing = findStep("issueSessionCredential");
	if (!issuing) return;
	// The key goes as the object the step declares it takes, so what the site published as this step's input is what
	// the page sends.
	const opening = openSession((holderKey) => conduit().follow<unknown>({ method: issuing.method, params: { holderKey } }, "open this reader's session"));
	// Said once, where a reader can see it. What waits on the session raises the same failure at the call that needed
	// it, so this is a notice rather than the handling of it.
	opening.catch((err: unknown) => console.warn(`[shu] this reader has no session: ${errorDetail(err)}`));
}

const main = async (): Promise<void> => {
	// What the reader's address says, before anything writes to it. An address naming views is the reader's own
	// arrangement, which is what lets two addresses show different views of one run; an address saying nothing is a
	// reader with no arrangement, and the run's own views are what they are shown.
	const arrivedWithAddress = getHash().length > 1;
	hydrateFromDom();
	// One conduit, whatever the page is: a page with a server behind it reaches it, and a page carrying its own run
	// reaches nothing, which every read already answers from what the page holds. Installed before anything else, since
	// every component reads through the accessor and would otherwise throw on first use.
	setConduit(new LiveConduit(""));
	// A page that carries its run fills the client cache with it before anything reads the run: every view then reads it
	// through the sources it uses against a server, and the reads that would have gone to a server find it cached.
	const carried = hydratedCache();
	if (carried) {
		setEventStream(new SerializedEventStream());
		await hydrateClientCache(carried);
		ShuElement.pushHash(getHydratedViewHash());
	} else {
		const live = new LiveEventStream("/sse");
		setEventStream(live);
		// Opened before anything reads the run: the server announces from the moment a page connects, so a page that
		// waited until its first view was ready would lose what the run said while it booted.
		live.connect();
	}
	// Install the shared design tokens at document level so combobox dropdowns and other elements rendered into document.body resolve the same `--shu-…` variables that shadow-DOM components inherit.
	installShuTokens();
	applyShuPreferences();
	seedHashFromQueryString();
	await registerComponents();

	const appRoot = document.getElementById("shu-main");
	if (!appRoot) return;

	try {
		await getAvailableSteps();
		openReaderSession();
	} catch (err) {
		if (!isOffline()) {
			appRoot.innerHTML = `<div style="padding:20px;color:#c00;font-family:monospace"><strong>SPA initialization failed:</strong> ${errorDetail(err)}</div>`;
			return;
		}
	}

	const apiBase = appRoot.getAttribute("data-api-base") || "/shu";

	if (!document.getElementById("graph-style")) {
		const style = document.createElement("style");
		style.id = "graph-style";
		style.textContent = LAYOUT_STYLE;
		document.head.appendChild(style);
	}

	const getStrip = () => appRoot.querySelector("shu-column-strip") as ShuColumnStrip | null;
	const getActionsBar = () => appRoot.querySelector(".app-container > shu-actions-bar") as ShuActionsBar | null;
	const getIndexPane = () => getStrip()?.panes.find((pane) => pane.dataset.columnKey === INDEX_PANE_KEY) ?? null;

	// A reader with no arrangement of their own is shown the views this run has shown, read from its records. A page
	// carrying its own run reads the records it carries, by the same read, so a report needs nothing precomputed.
	const shown = arrivedWithAddress ? [] : await viewsShown();
	if (shown.length > 0) ShuElement.pushHash(hashWithColumns(shown));

	const reportBootDiagnostic = (level: TClientLogLevel, msg: string, attrs?: Record<string, unknown>): void => reportToRun(level, "shu-app-boot", msg, attrs);
	reportBootDiagnostic("debug", "shu-app boot reached COLUMN_OPEN_AFFORDANCE wiring");

	const reportClientLog = (level: TClientLogLevel, message: string, attributes?: Record<string, unknown>): void => reportToRun(level, "shu-app", message, attributes);

	/**
	 * Structured-event channel for external-component lifecycle phases. Error-level
	 * emissions also carry `haibun.autonomic.event: "step.failure"` + exception
	 * attributes so the autonomic agent picks them up via the same peer-failure
	 * channel it uses for IMAP skips and lifecycle step failures — no per-source plumbing.
	 */
	const reportExternalComponent = (
		level: "debug" | "error" | "info" | "warn" | "error",
		phase: "lookup" | "fetch" | "register" | "mount" | "missing-ui" | "missing-script" | "fetch-failed" | "register-failed" | "mounted",
		component: string,
		extra: Record<string, unknown> = {},
	) => {
		const message = `external-component ${component}: ${phase}${extra.error ? ` — ${String(extra.error)}` : ""}`;
		const attributes: Record<string, unknown> = {
			"haibun.shu.external-component.phase": phase,
			"haibun.shu.external-component.name": component,
			...extra,
		};
		if (level === "error") {
			attributes["haibun.autonomic.event"] = "step.failure";
			attributes["exception.type"] = "ExternalComponentFailure";
			attributes["exception.message"] = typeof extra.error === "string" ? extra.error : message;
		}
		reportClientLog(level, message, attributes);
	};

	// Activate the pane at `index` through PaneState — the single owner of the active pane + the hash `active` (a
	// paneId). Writing a numeric index here (the old behaviour) desynced PaneState and corrupted the hash: a later
	// fromHash could not resolve the numeric and fell back to the leftmost pane, so active "didn't switch".
	const activatePaneByIndex = (index: number) => {
		const paneId = getStrip()?.panes[index]?.dataset.columnKey;
		if (paneId) PaneState.setActivePane(paneId);
	};

	// Build DOM — strip with query pane, then query component after (so .results-target exists first).
	// All other pane creation goes through PaneState (initialized further down).
	appRoot.innerHTML = `
		<div class="app-container">
			<shu-actions-bar api-base="${apiBase}" testid-prefix="app-"></shu-actions-bar>
			<shu-column-strip>
				<shu-column-pane label="" column-type="query" closable="false" active data-column-key="${INDEX_PANE_KEY}">
					<div class="results-target" style="height:100%;overflow:hidden;"></div>
					<shu-index-summary slot="spine"></shu-index-summary>
				</shu-column-pane>
			</shu-column-strip>
			<shu-graph-query api-base="${apiBase}" label="${defaultLabel()}" sort-order="desc" results-target=".results-target"></shu-graph-query>
		</div>
	`;

	// --- Event wiring ---
	const eventsController = new AbortController();
	const { signal } = eventsController;

	// Miller-column behavior: a click in column x replaces columns at index > x
	// (the subsequent panes are stale relative to the new selection). ctrl/shift
	// click in `detail.addToSelection` opts out and appends instead. Programmatic
	// dispatches that pass no modifier default to replace.
	appRoot.addEventListener(
		SHU_EVENT.PANE_DISMISS,
		((e: CustomEvent) => {
			const paneId = e.detail?.paneId;
			// The close is in the address at once: a reader who has closed a view has an arrangement, so nothing reseeds it.
			if (typeof paneId === "string" && paneId !== "query") PaneState.dismiss(paneId);
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		SHU_EVENT.STEP_CHOOSE,
		((e: CustomEvent) => {
			const method = e.detail?.method;
			if (typeof method !== "string") return;
			const args = e.detail?.args as Record<string, unknown> | undefined;
			const auto = Boolean(e.detail?.auto);
			getActionsBar()?.chooseStep?.(method, args, auto);
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		SHU_EVENT.COLUMN_OPEN,
		((e: CustomEvent) => {
			const { subject, label, addToSelection } = e.detail || {};
			if (!subject) return;
			// PaneState.requestFrom centralizes the Miller-column behaviour (dismiss every non-pinned pane to the right of the source). Every component that opens a column from a row click must reach this same path; direct `request` calls in views would skip the pruning and leak stale panes.
			PaneState.requestFrom(e, { paneType: "entity", id: subject, persistedAs: label || defaultLabel() }, Boolean(addToSelection));
		}) as EventListener,
		{ signal },
	);

	// Generic pane open: a view hands a fully-formed DesiredPane and it goes through the same PaneState path as
	// COLUMN_OPEN. The polymorphic uses this to open the windowed instances column (filter-prop) for an ontology Class/Property,
	// which COLUMN_OPEN (entity-only) can't express. Fail fast on a malformed request — no silent default pane.
	appRoot.addEventListener(
		SHU_EVENT.PANE_OPEN,
		((e: CustomEvent) => {
			const parsed = DesiredPaneSchema.safeParse(e.detail);
			if (!parsed.success) throw new Error(`[shu] ${SHU_EVENT.PANE_OPEN}: invalid DesiredPane: ${parsed.error.message}`);
			PaneState.requestFrom(e, parsed.data, false);
		}) as EventListener,
		{ signal },
	);

	// The shared loader (external-components.ts) with this app's diagnostic reporter bound.
	const ensureUiComponentLoaded = (childTag: string): Promise<void> => sharedEnsureUiComponentLoaded(childTag, reportExternalComponent);

	// Every person-visible step-end emits hypermedia products; if they carry view markers, route to PaneState — trace
	// substeps are infrastructure and never open views (see pane-event-router). Batching keeps only the latest op per
	// pane.
	subscribeBatchedEvents({
		onBatch: (events) => {
			for (const op of paneOpsFor(events).values()) {
				if (op.op === "component") PaneState.request({ paneType: "component", tag: op.tag, label: op.label, data: op.data });
				else PaneState.request({ paneType: "views-picker", views: op.views, label: op.label });
			}
		},
	});

	// Panes are removed only by an explicit close (PaneState.dismiss) or a Miller-column prune at the click origin
	// (PaneState.requestFrom). Results changing — a query re-run, or the initial query on a reload — must NOT remove
	// panes: that would drop component-pane views restored from the URL the moment those first results arrive.

	// Column widths persist via the pane's own ShuElement.persistFields (keyed by data-column-key) — no listener here.

	// Context change → forward to actions bar + publish selected subject onto the shared view-context store.
	appRoot.addEventListener(
		SHU_EVENT.CONTEXT_CHANGE,
		((e: CustomEvent) => {
			const detail = e.detail || {};
			const actionsBar = getActionsBar();
			if (actionsBar?.setContext && detail.patterns) {
				actionsBar.setContext(detail.patterns, detail.accessLevel || Access.private, detail);
			}
			// The selection axis moves only when the context addresses it (see selectionFromContext) — a query-context
			// publish never clears a selection another column just made.
			const sel = selectionFromContext(detail);
			if (sel.action === "select") setSelectedSubject(sel.subject, sel.label);
			else if (sel.action === "clear") setSelectedSubject(null, null);
		}) as EventListener,
		{ signal },
	);

	// A selection only holds while some un-minimized column actually shows it. Whenever the column set changes
	// (close, Miller-prune, minimize, expand), a selection whose column is gone or minimized is cleared so every
	// view undims — otherwise viewers stay focus-locked on a subject with no live column. Views surface their
	// subject via `data-subject`, so the contract is the attribute, not the protected `state` field.
	appRoot.addEventListener(
		SHU_EVENT.COLUMNS_CHANGED,
		(() => {
			const ctx = getViewContext();
			if (!ctx.selectedSubject) return;
			const live = getStrip()?.panes.some((p) => !p.hasAttribute(SHU_ATTR.DATA_MINIMIZED) && p.firstElementChild?.getAttribute("data-subject") === ctx.selectedSubject);
			if (!live) setSelectedSubject(null, null);
		}) as EventListener,
		{ signal },
	);

	// The actions bar owns its own resize now (it overlays the bottom and grows upward); see shu-actions-bar.ts.

	// Sync notifications — buffer rapid events into one consolidated message
	let syncDebounce: ReturnType<typeof setTimeout> | null = null;
	const syncBuffer: Map<string, number> = new Map(); // source → total indexed
	const SYNC_DEBOUNCE_MS = 2000;

	appRoot.addEventListener(
		SHU_EVENT.SYNC_AVAILABLE,
		((e: CustomEvent) => {
			const total = appRoot.querySelector(".result-total") as HTMLElement | null;
			if (total) total.classList.add("has-sync");
			const detail = e.detail || {};
			const desc = detail.folder ? `${detail.account}/${detail.folder}` : "mail";
			const count = typeof detail.indexed === "number" ? detail.indexed : 1;
			syncBuffer.set(desc, (syncBuffer.get(desc) || 0) + count);

			if (syncDebounce) clearTimeout(syncDebounce);
			syncDebounce = setTimeout(() => {
				const parts: string[] = [];
				for (const [source, n] of syncBuffer) {
					parts.push(`${n} message${n === 1 ? "" : "s"} from ${source}`);
				}
				syncBuffer.clear();
				syncDebounce = null;
				reportClientLog("debug", `Synced ${parts.join(", ")}`);
			}, SYNC_DEBOUNCE_MS);
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		"sync-request",
		(() => {
			const query = appRoot.querySelector("shu-graph-query") as ShuGraphQuery;
			if (query) {
				void query.loadMetadata?.();
				void query.executeQuery?.();
			}
			getActionsBar()?.notifyQueryCompleted?.();
			appRoot.querySelector(".result-total")?.classList.remove("has-sync");
		}) as EventListener,
		{ signal },
	);

	// The cursor names the moment the run is read at. A window holds a few thousand records, so a moment far from the
	// newest records is a moment no window holds: without this a reader who moved there would be shown the records they
	// had left. One rule for every way the cursor moves, so a press on the rail, a click on a row and scrubbing all read
	// the run the same way.
	eventsController.signal.addEventListener(
		"abort",
		timeCursor.subscribe((at) => {
			void readRunAt(at).catch((err: unknown) => failFastOrLog("the run could not be read at the moment the cursor names", err));
		}),
	);
	// Filter change from actions bar
	appRoot.addEventListener(
		SHU_EVENT.FILTER_CHANGE,
		((e: CustomEvent) => {
			const query = appRoot.querySelector("shu-graph-query") as ShuGraphQuery;
			query?.setFilters?.(e.detail || {});
			// A reader searching is asking to see what it finds, so the index comes back from its spine, whether it
			// minimized to give the run's views room or the reader put it there. The bar restoring its own search at
			// load asked for nothing, and leaves the index where it is.
			if (e.detail?.asked) getIndexPane()?.setMinimized(false);
		}) as EventListener,
		{ signal },
	);

	// A recorded search summary was clicked: re-apply its exact viewQuery snapshot through the query's
	// scriptable `products` entry — the same validated path a control step uses, so the restore is precise
	// (type, text, filters, sort, access) and the bar's controls re-sync via the resulting context change.
	appRoot.addEventListener(
		SHU_EVENT.SEARCH_RESTORE,
		((e: CustomEvent) => {
			const query = appRoot.querySelector("shu-graph-query") as ShuGraphQuery;
			if (!query) throw new Error("search-restore: no shu-graph-query in the app to restore into");
			query.products = e.detail.query;
		}) as EventListener,
		{ signal },
	);

	// Breadcrumb navigation → set the active pane; the `activePane` subscription below drives the rest.
	appRoot.addEventListener(
		"breadcrumb-nav",
		((e: CustomEvent) => {
			const { index } = e.detail || {};
			if (index === 0) (appRoot.querySelector("shu-graph-query") as ShuGraphQuery)?.deselectAll?.();
			activatePaneByIndex(index);
		}) as EventListener,
		{ signal },
	);

	// The active pane is the `activePane` signal (the strip paints it, the harvest reads it). Its ONE app-level reaction:
	// highlight the breadcrumb and publish the active view's column type to the dimming store. Replaces the old
	// COLUMN_ACTIVATED event round-trip and the separate active-view tracking they kept.
	const onActivePaneChange = (): void => {
		const panes = getStrip()?.panes ?? [];
		const index = panes.findIndex((p) => (p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE)) === activePane.get());
		getActionsBar()?.setActiveView?.(index);
		setActiveViewId(index >= 0 ? (panes[index]?.getAttribute(SHU_ATTR.COLUMN_TYPE) ?? null) : null);
	};
	signal.addEventListener("abort", activePane.subscribe(onActivePaneChange));

	// Columns changed → forward column labels to the actions-bar breadcrumb.
	// Hash output is owned by PaneState, not by this listener.
	appRoot.addEventListener(
		SHU_EVENT.COLUMNS_CHANGED,
		((e: CustomEvent) => {
			const columns: string[] = e.detail?.columns || [];
			getActionsBar()?.setColumns?.(columns);
		}) as EventListener,
		{ signal },
	);

	// Activate query pane on start. Its width restores itself via persistFields (data-column-key="query").
	const strip0 = getStrip();
	strip0?.activatePane(0);

	// PaneState owns the URL hash and every pane-creation path. The afterAttach hooks
	// adapt each variant's data into the existing column-component's open() RPC. Adding
	// a new pane variant means: add a schema entry + register one hook.
	if (strip0) {
		PaneState.init(strip0, {
			ensureLoaded: (tag) => ensureUiComponentLoaded(tag).catch(() => undefined),
			afterAttach: {
				entity: (d, child) => {
					if (d.paneType !== "entity") return;
					return (child as ShuEntityColumn).open(d.id, d.persistedAs, d.selector);
				},
				type: (d, child) => {
					if (d.paneType !== "type") return;
					return (child as import("./components/shu-type-column.js").ShuTypeColumn).open(d.persistedAs);
				},
				"filter-eq": (d, child) => {
					if (d.paneType !== "filter-eq") return;
					return (child as ShuFilterColumn).openFiltered(d.predicate, d.value, d.persistedAs);
				},
				"filter-prop": (d, child) => {
					if (d.paneType !== "filter-prop") return;
					return (child as ShuFilterColumn).openProperty(d.predicate, d.persistedAs);
				},
				"filter-incoming": (d, child) => {
					if (d.paneType !== "filter-incoming") return;
					return (child as ShuFilterColumn).openIncoming(d.subject, d.persistedAs);
				},
				thread: (d, child) => {
					if (d.paneType !== "thread") return;
					return (child as import("./components/shu-thread-column.js").ShuThreadColumn).open(d.persistedAs, d.subject);
				},
				"step-detail": (d, child) => {
					if (d.paneType !== "step-detail") return;
					return (child as HTMLElement & { open(s: number[]): Promise<void> }).open(d.seqPath);
				},
				"views-picker": (d, child) => {
					if (d.paneType !== "views-picker") return;
					const setViews = (child as HTMLElement & { setViews(v: unknown[]): void }).setViews;
					setViews.call(child, d.views);
				},
			},
		});
		// The query column is written into the boot markup, so it never passes through PaneState and nothing names it
		// active. Name it here, before reading the hash: a hash that describes panes replaces this, and one that does
		// not leaves the column that is on screen as the active pane rather than none.
		if (activePane.get() === null) activePane.set("query");
		PaneState.fromHash();
		// The index gives the run's views the room: a reader shown them asked for nothing, so the search that is on
		// screen minimizes to its spine, where it still says which search is behind it. A reader who arrived with an
		// arrangement of their own keeps the index as they left it.
		if (shown.length > 0) {
			const index = getIndexPane();
			if (!index) throw new Error("no index pane to minimize when the page started on the run's views — the app builds one at boot and nothing removes it");
			index.setMinimized(true);
		}
	}
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void main());
} else {
	void main();
}
