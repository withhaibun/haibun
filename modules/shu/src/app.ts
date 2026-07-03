import { defaultLabel } from "./util.js";
import { SHU_EVENT, SHU_ATTR } from "./consts.js";
/**
 * Main SPA entry point — uses shu-column-strip + shu-column-pane layout.
 * Query pane is sticky on the left, additional columns scroll right.
 * Each pane is resizable and independently rendered.
 */
import { hydrateFromDom, isStandaloneMode, getHydratedViewHash } from "./rpc-registry.js";
import { getCachedResponse } from "./rpc-cache.js";
import { Access } from "@haibun/core/lib/resources.js";
import { ShuElement } from "./components/shu-element.js";
import { registerComponents } from "./component-registry.js";
import { conduit, setConduit, LiveConduit, SerializedConduit, isOffline, type TDispatch } from "./hypermedia.js";
import { installShuTokens } from "./components/styles.js";
import { applyShuPreferences } from "./components/shu-theme-switch.js";
import * as ViewHash from "./view-hash.js";
import { setEventStream, LiveEventStream, SerializedEventStream, subscribeBatchedEvents } from "./event-stream.js";
import { getUiByComponent, getUiByType } from "./rels-cache.js";
import { paneOpsFor, createPaneRouteState, recordPaneDismissal } from "./pane-event-router.js";
import { setActiveViewId, setSelectedSubject, getViewContext } from "./quads-snapshot.js";
import { PaneState, DesiredPaneSchema } from "./pane-state.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuEntityColumn } from "./components/shu-entity-column.js";
import type { ShuFilterColumn } from "./components/shu-filter-column.js";
import type { ShuActionsBar } from "./components/shu-actions-bar.js";
import type { ShuGraphQuery } from "./components/shu-graph-query.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";

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

const main = async (): Promise<void> => {
	hydrateFromDom();
	const standalone = isStandaloneMode();
	// `ViewHash.setOffline` flips the URL/stored-state routing for view-hash IO so a standalone HTML report doesn't try to mutate `location.hash`.
	ViewHash.setOffline(standalone);
	if (standalone) ShuElement.pushHash(getHydratedViewHash());
	// Install the shared design tokens at document level so combobox dropdowns and other elements rendered into document.body resolve the same `--shu-…` variables that shadow-DOM components inherit.
	installShuTokens();
	applyShuPreferences();
	// Install the conduit + event-stream pair before anything else; every component reads via the accessor and would otherwise throw on first use. The Conduit identity (Serialized vs Live) is from this point the single source of truth for "is the SPA offline" — callers read `isOffline()` from hypermedia.ts.
	if (standalone) {
		const offlineDispatch: TDispatch = (method, params) => {
			// Serve responses captured during the live run (embedded in the report) — including the server-rendered graph SVG.
			const { found, value } = getCachedResponse(method, params ?? {});
			if (found) return value;
			throw new Error(`shu offline mode: no captured response for ${method} ${JSON.stringify(params).slice(0, 200)}`);
		};
		setConduit(new SerializedConduit(offlineDispatch));
		setEventStream(new SerializedEventStream());
	} else {
		setConduit(new LiveConduit(""));
		setEventStream(new LiveEventStream("/sse"));
	}
	seedHashFromQueryString();
	await registerComponents();

	const appRoot = document.getElementById("shu-main");
	if (!appRoot) return;

	try {
		const { getAvailableSteps } = await import("./rpc-registry.js");
		await getAvailableSteps();
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

	// Boot-time smoke test for the diagnostic channel.
	const reportBootDiagnostic = (level: "debug" | "info" | "warn" | "error", msg: string, attrs?: Record<string, unknown>) => {
		if (isOffline()) return;
		void conduit()
			.follow({ method: "MonitorStepper-logClient", params: { event: { level, source: "shu-app-boot", message: msg, attributes: attrs } } }, `app: boot diagnostic ${level}`)
			.catch((e) => failFastOrLog("[shu-boot] diagnostic failed:", e));
	};
	reportBootDiagnostic("debug", "shu-app boot reached COLUMN_OPEN_AFFORDANCE wiring");

	const reportClientLog = (level: "debug" | "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => {
		// Offline (standalone shu.html): no server to log to. Skip silently — the
		// diagnostic channel only exists in live mode.
		if (isOffline()) return;
		// Fail-fast — surface RPC plumbing issues that would otherwise hide every diagnostic.
		void conduit()
			.follow({ method: "MonitorStepper-logClient", params: { event: { level, message, source: "shu-app", attributes } } }, `app: client log ${level}`)
			.catch((err) => {
				const detail = errorDetail(err);
				console.error(`[shu] reportClientLog dispatch failed: ${detail}`, { level, message, attributes });
				throw new Error(`[shu] reportClientLog dispatch failed: ${detail}`);
			});
	};

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
				<shu-column-pane label="" column-type="query" closable="false" active data-column-key="query">
					<div class="results-target" style="height:100%;overflow:hidden;"></div>
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
	// Closed panes stay closed: the person's dismissal is watermarked at the newest event time seen and persisted, so
	// no replayed/older event — a reload's history replay, a previous run on a long-lived server — reopens the pane.
	// A freshly run step (a newer event) reopens it: a new decision. See pane-event-router.
	const PANE_DISMISSALS_KEY = "shu.paneDismissals";
	const readDismissals = (): Record<string, number> => {
		const raw = localStorage.getItem(PANE_DISMISSALS_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") throw new Error(`${PANE_DISMISSALS_KEY} is not an object — clear it`);
		return parsed as Record<string, number>;
	};
	const paneRouteState = createPaneRouteState(readDismissals());

	appRoot.addEventListener(
		SHU_EVENT.PANE_DISMISS,
		((e: CustomEvent) => {
			const paneId = e.detail?.paneId;
			if (typeof paneId === "string" && paneId !== "query") {
				PaneState.dismiss(paneId);
				localStorage.setItem(PANE_DISMISSALS_KEY, JSON.stringify(recordPaneDismissal(paneRouteState, paneId)));
			}
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
	// COLUMN_OPEN. The fisheye uses this to open the windowed instances column (filter-prop) for an ontology Class/Property,
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

	const ensureUiComponentLoaded = async (childTag: string): Promise<void> => {
		if (customElements.get(childTag)) {
			reportExternalComponent("debug", "register", childTag, { "haibun.shu.external-component.already-registered": true });
			return;
		}
		reportExternalComponent("debug", "lookup", childTag);
		const ui = getUiByComponent(childTag);
		if (!ui) {
			reportExternalComponent("error", "missing-ui", childTag);
			throw new Error(`[shu] no concern declares ui.component "${childTag}" — register a domain with ui:{component,js}`);
		}
		const js = typeof ui.js === "string" ? ui.js : "";
		if (!js) {
			reportExternalComponent("error", "missing-script", childTag);
			throw new Error(`[shu] concern for ${childTag} has no ui.js script URL`);
		}
		const src = js.startsWith("/") ? js : `/${js}`;
		reportExternalComponent("debug", "fetch", childTag, { "haibun.shu.external-component.url": src });
		try {
			await import(src);
		} catch (err) {
			const error = errorDetail(err);
			reportExternalComponent("error", "fetch-failed", childTag, { "haibun.shu.external-component.url": src, error });
			throw new Error(`[shu] failed to fetch ${src} for ${childTag}: ${error}`);
		}
		if (!customElements.get(childTag)) {
			reportExternalComponent("error", "register-failed", childTag, { "haibun.shu.external-component.url": src });
			throw new Error(`[shu] ${childTag} loaded from ${src} but customElements.get(${JSON.stringify(childTag)}) is undefined — bundle did not register the element`);
		}
		reportExternalComponent("debug", "mounted", childTag, { "haibun.shu.external-component.url": src });
	};

	// Every person-visible step-end emits hypermedia products; if they carry view markers, route to PaneState — trace
	// substeps are infrastructure and never open views, each event acts once, and a person's close outlasts the past
	// (see pane-event-router for the three rules). Batching keeps only the latest op per pane so the connect-time
	// replay costs one op per pane, not one per replayed step.
	subscribeBatchedEvents({
		onBatch: (events) => {
			const uiComponentByType = (type: string): string | undefined => {
				const component = getUiByType(type)?.component;
				return typeof component === "string" ? component : undefined;
			};
			for (const op of paneOpsFor(events, paneRouteState, uiComponentByType).values()) {
				if (op.op === "dismiss") PaneState.dismiss(op.view);
				else if (op.op === "component") PaneState.request({ paneType: "component", tag: op.tag, label: op.label, data: op.data });
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
			const subject = detail.patterns?.[0]?.s;
			setSelectedSubject(typeof subject === "string" ? subject : null, typeof detail.label === "string" ? detail.label : null);
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

	// Filter change from actions bar
	appRoot.addEventListener(
		SHU_EVENT.FILTER_CHANGE,
		((e: CustomEvent) => {
			const query = appRoot.querySelector("shu-graph-query") as ShuGraphQuery;
			query?.setFilters?.(e.detail || {});
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

	// Breadcrumb navigation
	appRoot.addEventListener(
		"breadcrumb-nav",
		((e: CustomEvent) => {
			const { index } = e.detail || {};
			const strip = getStrip();
			if (index === 0) {
				const query = appRoot.querySelector("shu-graph-query") as ShuGraphQuery;
				query?.deselectAll?.();
				strip?.activatePane(0);
				getActionsBar()?.setActiveView?.(0);
			} else if (strip) {
				strip.activatePane(index);
			}
			activatePaneByIndex(index);
		}) as EventListener,
		{ signal },
	);

	// Column activated (from strip) → update actions bar + hash, and publish the active view's column type onto the shared view-context store.
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_ACTIVATED,
		((e: CustomEvent) => {
			const { index } = e.detail || {};
			if (index !== undefined) {
				getActionsBar()?.setActiveView?.(index);
				activatePaneByIndex(index);
				const strip = getStrip();
				const pane = strip?.panes[index];
				const activeView = pane?.getAttribute(SHU_ATTR.COLUMN_TYPE) ?? null;
				setActiveViewId(activeView);
			}
		}) as EventListener,
		{ signal },
	);

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
					return (child as ShuEntityColumn).open(d.id, d.persistedAs);
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
		PaneState.fromHash();
	}
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void main());
} else {
	void main();
}
