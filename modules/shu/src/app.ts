import { defaultLabel } from "./util.js";
import { SHU_EVENT, SHU_ATTR, VIEW_EVENTS } from "./consts.js";
/**
 * Main SPA entry point — uses shu-column-strip + shu-column-pane layout.
 * Query pane is sticky on the left, additional columns scroll right.
 * Each pane is resizable and independently rendered.
 */
import { hydrateFromDom, isStandaloneMode, getHydratedViewHash } from "./rpc-registry.js";
import { Access } from "@haibun/core/lib/access.js";
import { ShuElement } from "./components/shu-element.js";
import { registerComponents } from "./component-registry.js";
import { SseClient } from "./sse-client.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuEntityColumn } from "./components/shu-entity-column.js";
import type { ShuFilterColumn } from "./components/shu-filter-column.js";
import type { ShuActionsBar } from "./components/shu-actions-bar.js";
import type { ShuGraphQuery } from "./components/shu-graph-query.js";

const LAYOUT_STYLE = `
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .notify-bar {
    flex: 0 0 auto; padding: 2px 8px; font-size: 12px; color: #555;
    background: #f0f4f0; border-bottom: 1px solid #ddd;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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
			appRoot.innerHTML = `<div style="padding:20px;color:#c00;font-family:monospace"><strong>SPA initialization failed:</strong> ${err instanceof Error ? err.message : err}</div>`;
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

	/** Remove all non-query, non-pinned panes from the strip. */
	const removeTransientPanes = (strip: ShuColumnStrip) => {
		const panes = strip.panes;
		for (let i = panes.length - 1; i >= 0; i--) {
			if (panes[i].getAttribute(SHU_ATTR.COLUMN_TYPE) !== "query" && !panes[i].hasAttribute(SHU_ATTR.PINNED)) {
				strip.removePane(i);
			}
		}
	};

	let notifyTimer: ReturnType<typeof setTimeout> | null = null;
	const showNotification = (message: string, duration = 5000) => {
		const notifyBar = appRoot.querySelector(".notify-bar") as HTMLElement | null;
		if (!notifyBar) return;
		notifyBar.textContent = message;
		notifyBar.style.display = "";
		if (notifyTimer) clearTimeout(notifyTimer);
		notifyTimer = setTimeout(() => {
			notifyBar.style.display = "none";
			notifyTimer = null;
		}, duration);
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

	/** Create an entity column pane with label encoded in key for hash persistence. */
	const createEntityPane = (id: string, vertexLabel: string = defaultLabel()): { pane: ShuColumnPane; entity: ShuEntityColumn } => {
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", id);
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, "entity");
		pane.dataset.columnKey = `e:${vertexLabel}:${id}`;
		const entity = document.createElement("shu-entity-column") as ShuEntityColumn;
		pane.appendChild(entity);
		return { pane, entity };
	};

	/** Create a filter column pane. */
	const createFilterPane = (colLabel: string, key: string): { pane: ShuColumnPane; filter: ShuFilterColumn } => {
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", colLabel);
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, "filter");
		pane.dataset.columnKey = key;
		const filter = document.createElement("shu-filter-column") as ShuFilterColumn;
		pane.appendChild(filter);
		return { pane, filter };
	};

	// Build DOM — strip with query pane, then query component after (so .results-target exists first)
	appRoot.innerHTML = `
		<div class="app-container">
			<shu-actions-bar api-base="${apiBase}" testid-prefix="app-"></shu-actions-bar>
			<div class="notify-bar" style="display:none"></div>
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

	// Row click → open entity column. Normal click replaces, ctrl/shift adds.
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_OPEN,
		((e: CustomEvent) => {
			const { subject, label } = e.detail || {};
			if (!subject) return;
			const strip = getStrip();
			if (!strip) return;

			// Reset columns only when the event originates from the main query table
			const fromQuery = e.composedPath().some((el) => el instanceof HTMLElement && el.tagName === "SHU-GRAPH-QUERY");
			if (fromQuery) removeTransientPanes(strip);

			const vertexLabel = label || defaultLabel();
			const { pane, entity } = createEntityPane(subject, vertexLabel);
			strip.addPane(pane);
			void entity.open(subject, vertexLabel);
		}) as EventListener,
		{ signal },
	);

	// Filter/property navigation from entity columns
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_OPEN_FILTER,
		((e: CustomEvent) => {
			const { property, value, label, type } = e.detail || {};
			if (!property) return;
			const strip = getStrip();
			if (!strip) return;
			const colLabel = value ? `${property}=${value}` : property;
			const key = value ? `f:${label || defaultLabel()}:${property}=${value}` : `p:${label || defaultLabel()}:${property}`;
			const { pane, filter } = createFilterPane(colLabel, key);
			strip.addPane(pane);
			if (type === "incoming") {
				void filter.openIncoming(value, label || defaultLabel());
			} else if (type === "property") {
				void filter.openProperty(property, label || defaultLabel());
			} else {
				void filter.openFiltered(property, value, label || defaultLabel());
			}
		}) as EventListener,
		{ signal },
	);

	// Monitor column — open log stream and/or sequence diagram
	/** Open a singleton pinned column. No-op if one of the same type already exists. */
	const openPinnedColumn = (columnType: string, label: string, childTag: string) => {
		const strip = getStrip();
		if (!strip) return;
		if (strip.panes.some((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === columnType)) return;
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", label);
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, columnType);
		pane.setAttribute(SHU_ATTR.PINNED, "true");
		const child = document.createElement(childTag);
		child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		pane.appendChild(child);
		strip.addPane(pane);
	};

	appRoot.addEventListener(SHU_EVENT.COLUMN_OPEN_MONITOR, () => openPinnedColumn("monitor", "Monitor", "shu-monitor-column"), {
		signal,
	});
	appRoot.addEventListener(SHU_EVENT.COLUMN_OPEN_SEQUENCE, () => openPinnedColumn("sequence", "Sequence", "shu-sequence-diagram"), {
		signal,
	});
	appRoot.addEventListener(SHU_EVENT.COLUMN_OPEN_DOCUMENT, () => openPinnedColumn("document", "Document", "shu-document-column"), { signal });
	appRoot.addEventListener(SHU_EVENT.COLUMN_OPEN_GRAPH, () => openPinnedColumn("graph", "Graph", "shu-graph-view"), {
		signal,
	});
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_OPEN_STEP,
		((e: CustomEvent) => {
			const seqPath = e.detail?.seqPath as number[] | undefined;
			if (!seqPath?.length) return;
			const strip = getStrip();
			if (!strip) return;
			const pane = document.createElement("shu-column-pane") as ShuColumnPane;
			pane.setAttribute("label", `Step [${seqPath.join(".")}]`);
			const detail = document.createElement("shu-step-detail");
			pane.appendChild(detail);
			strip.addPane(pane);
			void (detail as HTMLElement & { open(s: number[]): Promise<void> }).open(seqPath);
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		SHU_EVENT.COLUMN_OPEN_RELATED,
		((e: CustomEvent) => {
			const { subject, label } = e.detail || {};
			if (!subject || !label) return;
			const strip = getStrip();
			if (!strip) return;
			const pane = document.createElement("shu-column-pane") as ShuColumnPane;
			pane.setAttribute("label", `Replies: ${subject}`);
			pane.setAttribute(SHU_ATTR.COLUMN_TYPE, "thread");
			pane.dataset.columnKey = `t:${label}:${subject}`;
			const thread = document.createElement("shu-thread-column") as import("./components/shu-thread-column.js").ShuThreadColumn;
			pane.appendChild(thread);
			strip.addPane(pane);
			void thread.open(label, subject);
		}) as EventListener,
		{ signal },
	);

	const sseClient = SseClient.for("");
	sseClient.onEvent((event) => {
		const e = event as { kind?: string; type?: string; stage?: string; status?: string; products?: Record<string, unknown> };
		if (e.kind !== "lifecycle" || e.type !== "step" || e.stage !== "end" || e.status !== "completed" || !e.products) return;
		const view = e.products.view;
		if (typeof view === "string" && VIEW_EVENTS[view]) appRoot.dispatchEvent(new CustomEvent(VIEW_EVENTS[view], { bubbles: true }));
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

	// Context change → forward to actions bar
	appRoot.addEventListener(
		SHU_EVENT.CONTEXT_CHANGE,
		((e: CustomEvent) => {
			const detail = e.detail || {};
			const actionsBar = getActionsBar();
			if (actionsBar?.setContext && detail.patterns) {
				actionsBar.setContext(detail.patterns, detail.accessLevel || Access.private, detail);
			}
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
				showNotification(`Synced ${parts.join(", ")}`);
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

	// Column activated (from strip)
	appRoot.addEventListener(
		SHU_EVENT.COLUMN_ACTIVATED,
		((e: CustomEvent) => {
			const { index } = e.detail || {};
			if (index !== undefined) {
				getActionsBar()?.setActiveView?.(index);
				updateHashActiveView(index);
			}
		}) as EventListener,
		{ signal },
	);

	// Columns changed → update breadcrumb and hash
	appRoot.addEventListener(
		SHU_EVENT.COLUMNS_CHANGED,
		((e: CustomEvent) => {
			const columns: string[] = e.detail?.columns || [];
			const keys: string[] = e.detail?.keys || columns;
			getActionsBar()?.setColumns?.(columns);
			const h = ShuElement.getHash();
			const base = h.startsWith("#?") ? h : "#?";
			const params = new URLSearchParams(base.slice(2));
			params.delete("col");
			for (const key of keys) {
				params.append("col", key);
			}
			cleanParams(params);
			const newHash = `#?${params.toString()}`;
			ShuElement.pushHash(newHash);
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

	// Restore columns from URL hash
	const hash = ShuElement.getHash().replace(/^#\??/, "");
	const hashParams = new URLSearchParams(hash);
	const colParams = hashParams.getAll("col");
	const activeParam = hashParams.get("active");
	const idParam = hashParams.get("id");
	const labelParam = hashParams.get("label");
	// Auto-open entity column when id is specified in URL
	if (idParam && labelParam && colParams.length === 0) {
		const strip = getStrip();
		if (strip) {
			const { pane, entity } = createEntityPane(idParam, labelParam);
			strip.addPane(pane);
			void entity.open(idParam, labelParam);
		}
	} else if (colParams.length > 0) {
		const strip = getStrip();
		if (strip) {
			void (async () => {
				for (const rawCol of colParams) {
					const maximized = rawCol.endsWith("~max");
					const minimized = !maximized && rawCol.endsWith("~min");
					const col = maximized ? rawCol.slice(0, -4) : minimized ? rawCol.slice(0, -4) : rawCol;
					let pane: ShuColumnPane | undefined;
					if (col.startsWith("f:")) {
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const eqPart = rest.slice(colonIdx + 1);
						const eqIdx = eqPart.indexOf("=");
						const prop = eqPart.slice(0, eqIdx);
						const val = eqPart.slice(eqIdx + 1);
						const created = createFilterPane(`${prop}=${val}`, col);
						pane = created.pane;
						strip.addPane(pane);
						await created.filter.openFiltered(prop, val, lbl);
					} else if (col.startsWith("p:")) {
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const prop = rest.slice(colonIdx + 1);
						const created = createFilterPane(prop, col);
						pane = created.pane;
						strip.addPane(pane);
						await created.filter.openProperty(prop, lbl);
					} else if (col.startsWith("e:")) {
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const vid = rest.slice(colonIdx + 1);
						const created = createEntityPane(vid, lbl);
						pane = created.pane;
						strip.addPane(pane);
						await created.entity.open(vid, lbl);
					} else if (col.startsWith("t:")) {
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const vid = rest.slice(colonIdx + 1);
						appRoot.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_RELATED, { detail: { subject: vid, label: lbl }, bubbles: true }));
						pane = strip.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "thread");
					} else if (col.startsWith("monitor:") || col === "monitor") {
						appRoot.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_MONITOR, { bubbles: true }));
						pane = strip.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "monitor");
					} else if (col.startsWith("sequence:") || col === "sequence") {
						appRoot.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_SEQUENCE, { bubbles: true }));
						pane = strip.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "sequence");
					} else if (col.startsWith("graph:") || col === "graph") {
						appRoot.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_GRAPH, { bubbles: true }));
						pane = strip.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "graph");
					} else if (col.startsWith("document:") || col === "document") {
						appRoot.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_DOCUMENT, { bubbles: true }));
						pane = strip.panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "document");
					}
					if (minimized && pane) {
						pane.setCollapsed(true);
						pane.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
					}
					if (maximized && pane) {
						pane.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
						pane.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { bubbles: true, composed: true }));
					}
				}
				const activeIdx = activeParam !== null ? parseInt(activeParam, 10) : 0;
				getActionsBar()?.setActiveView?.(activeIdx);
				strip.activatePane(activeIdx);
			})();
		}
	}
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void main());
} else {
	void main();
}
