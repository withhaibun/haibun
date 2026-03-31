import { defaultLabel } from "./util.js";
/**
 * Main SPA entry point — uses shu-column-strip + shu-column-pane layout.
 * Query pane is sticky on the left, additional columns scroll right.
 * Each pane is resizable and independently rendered.
 */
import { registerComponents } from "./component-registry.js";
import type { ShuColumnStrip } from "./shu-column-strip.js";
import type { ShuColumnPane } from "./shu-column-pane.js";
import type { ShuEntityColumn } from "./shu-entity-column.js";
import type { ShuFilterColumn } from "./shu-filter-column.js";

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

type ActionsBarEl = HTMLElement & {
	setColumns?: (cols: string[]) => void;
	setActiveView?: (index: number) => void;
	setContext?: (patterns: unknown[], accessLevel: string, extra?: Record<string, unknown>) => void;
	notifyQueryCompleted?: () => void;
};

type QueryEl = HTMLElement & {
	loadMetadata?: () => Promise<void>;
	executeQuery?: () => Promise<void>;
	setFilters?: (filters: Record<string, unknown>) => void;
	deselectAll?: () => void;
};

/** Remove blank/default params from URLSearchParams to keep hash clean. */
function cleanParams(params: URLSearchParams): void {
	const defaults = new Set(["0", "", "desc", "private"]);
	for (const key of [...params.keys()]) {
		const val = params.get(key);
		if (val !== null && defaults.has(val) && key !== "col" && key !== "label") {
			params.delete(key);
		}
	}
}

const main = async (): Promise<void> => {
	await registerComponents();

	const appRoot = document.getElementById("shu-main");
	if (!appRoot) return;

	const apiBase = appRoot.getAttribute("data-api-base") || "/shu";
	const SPLITTER_COOKIE = "shu-actions-height";

	if (!document.getElementById("graph-style")) {
		const style = document.createElement("style");
		style.id = "graph-style";
		style.textContent = LAYOUT_STYLE;
		document.head.appendChild(style);
	}

	const getStrip = () => appRoot.querySelector("shu-column-strip") as ShuColumnStrip | null;
	const getActionsBar = () => appRoot.querySelector(".app-container > shu-actions-bar") as ActionsBarEl | null;

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
		const h = location.hash.startsWith("#?") ? location.hash : "#?";
		const params = new URLSearchParams(h.slice(2));
		if (index > 0) {
			params.set("active", String(index));
		} else {
			params.delete("active");
		}
		cleanParams(params);
		const newHash = `#?${params.toString()}`;
		if (location.hash !== newHash) history.replaceState(null, "", newHash);
	};

	/** Create an entity column pane with label encoded in key for hash persistence. */
	const createEntityPane = (
		id: string,
		vertexLabel: string = defaultLabel(),
	): { pane: ShuColumnPane; entity: ShuEntityColumn } => {
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", id);
		pane.setAttribute("column-type", "entity");
		pane.dataset.columnKey = `e:${vertexLabel}:${id}`;
		const entity = document.createElement("shu-entity-column") as ShuEntityColumn;
		pane.appendChild(entity);
		return { pane, entity };
	};

	/** Create a filter column pane. */
	const createFilterPane = (colLabel: string, key: string): { pane: ShuColumnPane; filter: ShuFilterColumn } => {
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", colLabel);
		pane.setAttribute("column-type", "filter");
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
		"column-open",
		((e: CustomEvent) => {
			const { subject, label } = e.detail || {};
			if (!subject) return;
			const strip = getStrip();
			if (!strip) return;

			// Reset columns only when the event originates from the main query table
			const fromQuery = e.composedPath().some((el) => el instanceof HTMLElement && el.tagName === "SHU-GRAPH-QUERY");
			if (fromQuery) {
				const panes = strip.panes;
				for (let i = panes.length - 1; i >= 0; i--) {
					if (panes[i].getAttribute("column-type") !== "query") {
						strip.removePane(i);
					}
				}
			}

			const vertexLabel = label || defaultLabel();
			const { pane, entity } = createEntityPane(subject, vertexLabel);
			strip.addPane(pane);
			void entity.open(subject, vertexLabel);
		}) as EventListener,
		{ signal },
	);

	// Filter/property navigation from entity columns
	appRoot.addEventListener(
		"column-open-filter",
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

	// Results changed → remove all non-query panes
	appRoot.addEventListener(
		"results-changed",
		(() => {
			const h = location.hash;
			if (h.startsWith("#?") && new URLSearchParams(h.slice(2)).has("col")) return;
			const strip = getStrip();
			if (!strip) return;
			const panes = strip.panes;
			for (let i = panes.length - 1; i >= 0; i--) {
				if (panes[i].getAttribute("column-type") !== "query") {
					strip.removePane(i);
				}
			}
		}) as EventListener,
		{ signal },
	);

	// Context change → forward to actions bar
	appRoot.addEventListener(
		"context-change",
		((e: CustomEvent) => {
			const detail = e.detail || {};
			const actionsBar = getActionsBar();
			if (actionsBar?.setContext && detail.patterns) {
				actionsBar.setContext(detail.patterns, detail.accessLevel || "private", detail);
			}
		}) as EventListener,
		{ signal },
	);

	// Summary bar drag resize
	let resizeStartH = 0;
	let resizeStartY = 0;
	appRoot.addEventListener(
		"resize-drag",
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
		"resize-end",
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

	// Sync notifications
	appRoot.addEventListener(
		"sync-available",
		((e: CustomEvent) => {
			const total = appRoot.querySelector(".result-total") as HTMLElement | null;
			if (total) total.classList.add("has-sync");
			const detail = e.detail || {};
			const desc = detail.folder ? `${detail.account}/${detail.folder}` : "mail";
			showNotification(`${detail.indexed || "New"} message${detail.indexed === 1 ? "" : "s"} synced from ${desc}`);
		}) as EventListener,
		{ signal },
	);

	appRoot.addEventListener(
		"sync-request",
		(() => {
			const query = appRoot.querySelector("shu-graph-query") as QueryEl;
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
		"filter-change",
		((e: CustomEvent) => {
			const query = appRoot.querySelector("shu-graph-query") as QueryEl;
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
				const query = appRoot.querySelector("shu-graph-query") as QueryEl;
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
		"column-activated",
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
		"columns-changed",
		((e: CustomEvent) => {
			const columns: string[] = e.detail?.columns || [];
			const keys: string[] = e.detail?.keys || columns;
			getActionsBar()?.setColumns?.(columns);
			const h = location.hash;
			const base = h.startsWith("#?") ? h : "#?";
			const params = new URLSearchParams(base.slice(2));
			params.delete("col");
			for (const key of keys) {
				params.append("col", key);
			}
			cleanParams(params);
			const newHash = `#?${params.toString()}`;
			if (location.hash !== newHash) {
				history.replaceState(null, "", newHash);
			}
		}) as EventListener,
		{ signal },
	);

	// Activate query pane on start
	getStrip()?.activatePane(0);

	// Restore columns from URL hash
	const hash = location.hash.replace(/^#\??/, "");
	const hashParams = new URLSearchParams(hash);
	const colParams = hashParams.getAll("col");
	const activeParam = hashParams.get("active");
	if (colParams.length > 0) {
		const strip = getStrip();
		if (strip) {
			void (async () => {
				for (const col of colParams) {
					if (col.startsWith("f:")) {
						// f:Email:folder=INBOX
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const eqPart = rest.slice(colonIdx + 1);
						const eqIdx = eqPart.indexOf("=");
						const prop = eqPart.slice(0, eqIdx);
						const val = eqPart.slice(eqIdx + 1);
						const { pane, filter } = createFilterPane(`${prop}=${val}`, col);
						strip.addPane(pane);
						await filter.openFiltered(prop, val, lbl);
					} else if (col.startsWith("p:")) {
						// p:Email:subject
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const prop = rest.slice(colonIdx + 1);
						const { pane, filter } = createFilterPane(prop, col);
						strip.addPane(pane);
						await filter.openProperty(prop, lbl);
					} else if (col.startsWith("e:")) {
						// e:Contact:alice@example.com
						const rest = col.slice(2);
						const colonIdx = rest.indexOf(":");
						const lbl = rest.slice(0, colonIdx);
						const vid = rest.slice(colonIdx + 1);
						const { pane, entity } = createEntityPane(vid, lbl);
						strip.addPane(pane);
						await entity.open(vid, lbl);
					} else {
						// Plain vertex ID (legacy)
						const { pane, entity } = createEntityPane(col);
						strip.addPane(pane);
						await entity.open(col, defaultLabel());
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
