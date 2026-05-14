import { defaultLabel } from "./util.js";
import { SHU_EVENT, SHU_ATTR } from "./consts.js";
/**
 * Main SPA entry point — uses shu-column-strip + shu-column-pane layout.
 * Query pane is sticky on the left, additional columns scroll right.
 * Each pane is resizable and independently rendered.
 */
import { hydrateFromDom, isStandaloneMode, getHydratedViewHash } from "./rpc-registry.js";
import { Access } from "@haibun/core/lib/resources.js";
import { ShuElement } from "./components/shu-element.js";
import { registerComponents } from "./component-registry.js";
import { SseClient, inAction } from "./sse-client.js";
import { getUiByComponent, getVertexUi } from "./rels-cache.js";
import { parseAffordanceProduct } from "./affordance-products.js";
import { setActiveViewId, setSelectedSubject, getViewContext } from "./quads-snapshot.js";
import { PaneState } from "./pane-state.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuEntityColumn } from "./components/shu-entity-column.js";
import type { ShuFilterColumn } from "./components/shu-filter-column.js";
import type { ShuActionsBar } from "./components/shu-actions-bar.js";
import type { ShuGraphQuery } from "./components/shu-graph-query.js";
import { type THypermediaProducts, type THaibunEvent } from "@haibun/core/schema/protocol.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";

const LAYOUT_STYLE = `
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .app-container > shu-actions-bar {
    flex: 0 0 auto;
    border-bottom: 1px solid #ddd;
    overflow: hidden;
    max-height: 50vh;
    max-height: 50dvh;
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

/** Remove blank/default params from URLSearchParams to keep hash clean. */
function cleanParams(params: URLSearchParams): void {
	const defaults = new Set(["0", "", "desc", Access.private]);
	for (const key of [...params.keys()]) {
		const val = params.get(key);
		if (val !== null && defaults.has(val) && key !== "col" && key !== "label") {
			params.delete(key);
		}
	}
}

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
	ShuElement.offline = isStandaloneMode();
	if (ShuElement.offline) ShuElement.pushHash(getHydratedViewHash());
	seedHashFromQueryString();
	await registerComponents();

	const appRoot = document.getElementById("shu-main");
	if (!appRoot) return;

	try {
		const { getAvailableSteps } = await import("./rpc-registry.js");
		await getAvailableSteps();
	} catch (err) {
		if (!ShuElement.offline) {
			appRoot.innerHTML = `<div style="padding:20px;color:#c00;font-family:monospace"><strong>SPA initialization failed:</strong> ${errorDetail(err)}</div>`;
			return;
		}
	}

	const apiBase = appRoot.getAttribute("data-api-base") || "/shu";
	const SPLITTER_COOKIE = "shu-actions-height";
	const QUERY_WIDTH_COOKIE = "shu-query-width";

	if (!document.getElementById("graph-style")) {
		const style = document.createElement("style");
		style.id = "graph-style";
		style.textContent = LAYOUT_STYLE;
		document.head.appendChild(style);
	}

	const getStrip = () => appRoot.querySelector("shu-column-strip") as ShuColumnStrip | null;
	const getActionsBar = () => appRoot.querySelector(".app-container > shu-actions-bar") as ShuActionsBar | null;

	/** Dismiss every non-query, non-pinned pane at indices > sourceIdx via PaneState. Pass -1 to prune all. */
	const prunePanesAfterIndex = (strip: ShuColumnStrip, sourceIdx: number): void => {
		const panes = strip.panes;
		for (let i = panes.length - 1; i > sourceIdx; i--) {
			const pane = panes[i];
			if (pane.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query" || pane.hasAttribute(SHU_ATTR.PINNED)) continue;
			const paneId = pane.dataset.columnKey;
			if (paneId) PaneState.dismiss(paneId);
		}
	};
	/** Dismiss every non-query, non-pinned pane via PaneState. */
	const removeTransientPanes = (strip: ShuColumnStrip) => prunePanesAfterIndex(strip, -1);

	// Boot-time smoke test for the diagnostic channel.
	const reportBootDiagnostic = (level: "debug" | "info" | "warn" | "error", msg: string, attrs?: Record<string, unknown>) => {
		if (ShuElement.offline) return;
		void inAction(async (scope) => {
			await SseClient.for("").rpc(scope, "MonitorStepper-logClient", { event: { level, source: "shu-app-boot", message: msg, attributes: attrs } });
		}).catch((e) => failFastOrLog("[shu-boot] diagnostic failed:", e));
	};
	reportBootDiagnostic("debug", "shu-app boot reached COLUMN_OPEN_AFFORDANCE wiring");

	const reportClientLog = (level: "debug" | "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => {
		// Offline (standalone shu.html): no server to log to. Skip silently — the
		// diagnostic channel only exists in live mode.
		if (ShuElement.offline) return;
		// Fail-fast — surface RPC plumbing issues that would otherwise hide every diagnostic.
		void inAction(async (scope) => {
			await SseClient.for("").rpc(scope, "MonitorStepper-logClient", { event: { level, message, source: "shu-app", attributes } });
		}).catch((err) => {
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

	const updateHashActiveView = (index: number) => {
		const currentHash = ShuElement.getHash();
		const h = currentHash.startsWith("#?") ? currentHash : "#?";
		const params = new URLSearchParams(h.slice(2));
		if (index > 0) {
			params.set("active", String(index));
		} else {
			params.delete("active");
		}
		cleanParams(params);
		const newHash = `#?${params.toString()}`;
		ShuElement.pushHash(newHash);
	};

	// Build DOM — strip with query pane, then query component after (so .results-target exists first).
	// All other pane creation goes through PaneState (initialized further down).
	appRoot.innerHTML = `
		<div class="app-container">
			<shu-actions-bar api-base="${apiBase}" testid-prefix="app-"></shu-actions-bar>
			<shu-column-strip>
				<shu-column-pane label="" column-type="query" closable="false" active>
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
	appRoot.addEventListener(
		SHU_EVENT.PANE_DISMISS,
		((e: CustomEvent) => {
			const paneId = e.detail?.paneId;
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
			const strip = getStrip();
			if (!strip) return;
			// Miller-column: a click in column x replaces subsequent panes unless modifier-clicked.
			if (!addToSelection) {
				const sourcePane = e.composedPath().find((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "SHU-COLUMN-PANE") as ShuColumnPane | undefined;
				const sourceIdx = sourcePane ? strip.panes.indexOf(sourcePane) : -1;
				if (sourceIdx >= 0) prunePanesAfterIndex(strip, sourceIdx);
			}
			PaneState.request({ paneType: "entity", id: subject, vertexLabel: label || defaultLabel() });
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
		reportExternalComponent("info", "fetch", childTag, { "haibun.shu.external-component.url": src });
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

	// Every step-end emits hypermedia products; if they carry view markers, route to PaneState.
	const sseClient = SseClient.for("");
	sseClient.onEvent((event) => {
		const e = event as THaibunEvent & { products?: THypermediaProducts };
		if (e.kind !== "lifecycle" || e.type !== "step" || e.stage !== "end" || e.status !== "completed" || !e.products) return;
		const action = parseAffordanceProduct(e.products);
		if (action.kind === "none") return;
		if (action.kind === "close") return PaneState.dismiss(action.view);
		if (action.kind === "open-component") return PaneState.request({ paneType: "component", tag: action.component, label: action.label, data: action.products });
		if (action.kind === "show-views") return PaneState.request({ paneType: "views-picker", views: action.views, label: action.label });
		const ui = getVertexUi(action.type);
		if (!ui?.component || typeof ui.component !== "string") throw new Error(`No affordance component mapped for type ${action.type}`);
		PaneState.request({ paneType: "component", tag: ui.component, label: action.label, data: action.products });
	});

	// Results changed → remove all non-query panes
	appRoot.addEventListener(
		SHU_EVENT.RESULTS_CHANGED,
		(() => {
			const h = ShuElement.getHash();
			if (h.startsWith("#?") && new URLSearchParams(h.slice(2)).has("col")) return;
			const strip = getStrip();
			if (!strip) return;
			removeTransientPanes(strip);
		}) as EventListener,
		{ signal },
	);

	// Time sync → fan out to all panes and light-DOM components
	appRoot.addEventListener(
		SHU_EVENT.TIME_SYNC,
		((e: CustomEvent) => {
			const strip = getStrip();
			if (!strip) return;
			for (const pane of strip.panes) {
				const child = pane.firstElementChild;
				if (child && child !== e.target) child.dispatchEvent(new CustomEvent(SHU_EVENT.TIME_SYNC, { detail: e.detail }));
			}
			appRoot.querySelectorAll("shu-result-table").forEach((el) => {
				el.dispatchEvent(new CustomEvent(SHU_EVENT.TIME_SYNC, { detail: e.detail }));
			});
		}) as EventListener,
		{ signal },
	);

	// Column resize → persist query pane width to cookie
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_RESIZE,
		((e: CustomEvent) => {
			const pane = (e.target as HTMLElement)?.closest("shu-column-pane");
			if (pane?.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query" && e.detail?.width) {
				document.cookie = `${QUERY_WIDTH_COOKIE}=${e.detail.width}; path=/; max-age=${60 * 60 * 24 * 365}`;
			}
		}) as EventListener,
		{ signal },
	);

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

	// Closing the column whose content carries the current selection clears the
	// selection — otherwise viewers remain "focus-locked" on a subject the user
	// has navigated away from. Views surface their subject via `data-subject` so
	// the contract is the attribute, not the protected `state` field.
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_CLOSE,
		((e: CustomEvent) => {
			const pane = e.target as HTMLElement | null;
			if (!pane) return;
			const ctx = getViewContext();
			if (!ctx.selectedSubject) return;
			const closingSubject = pane.firstElementChild?.getAttribute("data-subject");
			if (closingSubject === ctx.selectedSubject) setSelectedSubject(null, null);
		}) as EventListener,
		{ signal },
	);

	// Summary bar drag resize
	let resizeStartH = 0;
	let resizeStartY = 0;
	appRoot.addEventListener(
		SHU_EVENT.RESIZE_DRAG,
		((e: CustomEvent) => {
			const ab = appRoot.querySelector(".app-container > shu-actions-bar") as HTMLElement | null;
			if (!ab) return;
			if (resizeStartH === 0) {
				resizeStartH = ab.offsetHeight;
				resizeStartY = e.detail.clientY;
			}
			const h = Math.max(28, resizeStartH + (e.detail.clientY - resizeStartY));
			ab.style.maxHeight = `${h}px`;
			ab.style.height = "";
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		SHU_EVENT.RESIZE_END,
		(() => {
			const ab = appRoot.querySelector(".app-container > shu-actions-bar") as HTMLElement | null;
			if (ab && resizeStartH > 0) {
				const maxH = parseInt(ab.style.maxHeight) || ab.offsetHeight;
				if (maxH < 50) {
					ab.style.maxHeight = "";
					document.cookie = `${SPLITTER_COOKIE}=; path=/; max-age=0`;
				} else {
					document.cookie = `${SPLITTER_COOKIE}=${maxH}; path=/; max-age=${60 * 60 * 24 * 365}`;
				}
			}
			resizeStartH = 0;
		}) as EventListener,
		{ signal },
	);

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
				reportClientLog("info", `Synced ${parts.join(", ")}`);
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
			updateHashActiveView(index);
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
				updateHashActiveView(index);
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

	// Activate query pane on start, restore saved width
	const strip0 = getStrip();
	strip0?.activatePane(0);
	const savedQueryWidth = document.cookie.match(new RegExp(`(?:^|; )${QUERY_WIDTH_COOKIE}=([^;]*)`))?.[1];
	if (savedQueryWidth && strip0) {
		const queryPane = strip0.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query");
		if (queryPane) queryPane.setWidth(parseInt(savedQueryWidth, 10));
	}

	// PaneState owns the URL hash and every pane-creation path. The afterAttach hooks
	// adapt each variant's data into the existing column-component's open() RPC. Adding
	// a new pane variant means: add a schema entry + register one hook.
	if (strip0) {
		PaneState.init(strip0, {
			ensureLoaded: (tag) => ensureUiComponentLoaded(tag).catch(() => undefined),
			afterAttach: {
				entity: (d, child) => {
					if (d.paneType !== "entity") return;
					return (child as ShuEntityColumn).open(d.id, d.vertexLabel);
				},
				"filter-eq": (d, child) => {
					if (d.paneType !== "filter-eq") return;
					return (child as ShuFilterColumn).openFiltered(d.predicate, d.value, d.vertexLabel);
				},
				"filter-prop": (d, child) => {
					if (d.paneType !== "filter-prop") return;
					return (child as ShuFilterColumn).openProperty(d.predicate, d.vertexLabel);
				},
				"filter-incoming": (d, child) => {
					if (d.paneType !== "filter-incoming") return;
					return (child as ShuFilterColumn).openIncoming(d.subject, d.vertexLabel);
				},
				thread: (d, child) => {
					if (d.paneType !== "thread") return;
					return (child as import("./components/shu-thread-column.js").ShuThreadColumn).open(d.vertexLabel, d.subject);
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
