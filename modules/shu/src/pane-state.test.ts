// @vitest-environment jsdom
/**
 * Contract for the PaneState reconciler.
 *
 * Pinned invariants: idempotency, hash round-trip, dedup-by-derived-id, and
 * malformed col= entries are skipped (never crashed-on).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PaneState, parseColEntry, DesiredPaneSchema, paneIdOf, tagOf, labelOf } from "./pane-state.js";
import { ShuElement } from "./components/shu-element.js";
import { setSiteMetadata, type SiteMetadata } from "./rels-cache.js";
import * as ViewHash from "./view-hash.js";

const emptyMeta = (ui: SiteMetadata["ui"] = {}): SiteMetadata => ({
	types: [],
	idFields: {},
	rels: {},
	edgeRanges: {},
	properties: {},
	queryable: {},
	summary: {},
	ui,
	propertyDefinitions: {},
});

describe("derived helpers", () => {
	it("paneIdOf is unique per variant data", () => {
		expect(paneIdOf({ paneType: "component", tag: "shu-graph-view", label: "G" })).toBe("shu-graph-view");
		expect(paneIdOf({ paneType: "entity", id: "msg-1", persistedAs: "Email" })).toBe("e:Email:msg-1");
		expect(paneIdOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" })).toBe("f:Email:from=a@b");
		expect(paneIdOf({ paneType: "thread", persistedAs: "Email", subject: "msg-42" })).toBe("t:Email:msg-42");
		expect(paneIdOf({ paneType: "step-detail", seqPath: [0, 1, 2] })).toBe("step:0.1.2");
	});

	it("tagOf maps each paneType to its column-component, components reuse their tag", () => {
		expect(tagOf({ paneType: "component", tag: "shu-graph-view", label: "G" })).toBe("shu-graph-view");
		expect(tagOf({ paneType: "entity", id: "x", persistedAs: "Email" })).toBe("shu-entity-column");
		expect(tagOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "p", value: "v" })).toBe("shu-filter-column");
		expect(tagOf({ paneType: "thread", persistedAs: "Email", subject: "s" })).toBe("shu-thread-column");
	});

	it("an entity opens its @type's declared column component, defaulting to the generic entity column", () => {
		setSiteMetadata(emptyMeta({ Task: { component: "shu-task-column" } }));
		expect(tagOf({ paneType: "entity", id: "t1", persistedAs: "Task" })).toBe("shu-task-column"); // @type declares its own column
		expect(tagOf({ paneType: "entity", id: "e1", persistedAs: "Email" })).toBe("shu-entity-column"); // none declared → generic
		setSiteMetadata(emptyMeta()); // reset so other tests see no per-type ui
	});

	it("labelOf derives a display label per variant", () => {
		expect(labelOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" })).toBe("from=a@b");
		expect(labelOf({ paneType: "entity", id: "msg-1", persistedAs: "Email" })).toBe("msg-1");
		expect(labelOf({ paneType: "entity", id: "msg-1", persistedAs: "Email", label: "Override" })).toBe("Override");
	});
});

describe("parseColEntry", () => {
	it("round-trips a component pane", () => {
		const d = parseColEntry("shu-graph-view");
		expect(d?.paneType).toBe("component");
		if (d?.paneType === "component") expect(d.tag).toBe("shu-graph-view");
	});

	it("round-trips an entity pane with a flag", () => {
		const d = parseColEntry("e:Email:msg-1~max");
		expect(d?.paneType).toBe("entity");
		expect(d?.flag).toBe("max");
		expect(d && paneIdOf(d)).toBe("e:Email:msg-1");
	});

	it("returns null for malformed entries", () => {
		expect(parseColEntry("e:")).toBeNull();
		expect(parseColEntry("Bad Tag")).toBeNull();
		expect(parseColEntry("step:not.a.number")).toBeNull();
	});

	it("rejects components with uppercase or whitespace", () => {
		expect(parseColEntry("ShuGraphView")).toBeNull();
		expect(parseColEntry("shu graph")).toBeNull();
	});

	it("DesiredPaneSchema rejects unknown paneType", () => {
		expect(() => DesiredPaneSchema.parse({ paneType: "unknown" })).toThrow();
	});
});

describe("PaneState", () => {
	beforeEach(() => {
		PaneState.__resetForTests();
		document.body.innerHTML = "";
		ViewHash.setOffline(true);
		ShuElement.pushHash("#?");
		if (!customElements.get("shu-column-pane"))
			customElements.define(
				"shu-column-pane",
				class extends HTMLElement {
					setMinimized(m: boolean) {
						this.toggleAttribute("data-minimized", m);
					}
				},
			);
		if (!customElements.get("shu-column-strip")) {
			customElements.define(
				"shu-column-strip",
				class extends HTMLElement {
					get panes(): HTMLElement[] {
						return Array.from(this.querySelectorAll("shu-column-pane"));
					}
					addPane(p: HTMLElement) {
						this.appendChild(p);
					}
					activatePane(_i: number) {
						/* no-op: activation side-effects are not under test here */
					}
					removePane(i: number) {
						const p = this.panes[i];
						if (!p) throw new Error(`test stub strip: removePane index ${i} out of range (have ${this.panes.length})`);
						p.remove();
					}
					updateAccordion() {
						/* no-op: layout is not under test here */
					}
					applyMaximize(_p: HTMLElement, _max: boolean) {
						/* no-op: layout is not under test here */
					}
				},
			);
		}
		if (!customElements.get("shu-affordances-panel")) customElements.define("shu-affordances-panel", class extends HTMLElement {});
		if (!customElements.get("shu-monitor-column")) customElements.define("shu-monitor-column", class extends HTMLElement {});
		if (!customElements.get("shu-graph-view")) customElements.define("shu-graph-view", class extends HTMLElement {});
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", class extends HTMLElement {});

		const strip = document.createElement("shu-column-strip");
		document.body.appendChild(strip);
		// biome-ignore lint/suspicious/noExplicitAny: test-only — strip facade is narrower than real ShuColumnStrip.
		PaneState.init(strip as any);
	});

	const flush = async () => {
		for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
	};

	it("request creates exactly one pane per derived id; re-request is idempotent", async () => {
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
	});

	it("dismiss removes the pane and the col= entry from the hash", async () => {
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
		PaneState.dismiss("shu-monitor-column");
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(0);
		expect(ShuElement.getHash()).not.toMatch(/col=shu-monitor-column/);
	});

	it("hash round-trip preserves the col= set", async () => {
		ShuElement.pushHash("#?col=shu-graph-view&col=shu-monitor-column&active=shu-monitor-column");
		PaneState.fromHash();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-graph-view", "shu-monitor-column"]);
	});

	it("a boot column activation BEFORE fromHash must not strip the restored col= views (regression)", async () => {
		// A reloaded URL carries two restored views and a remembered active pane.
		ShuElement.pushHash("#?col=shu-graph-view&col=shu-affordances-panel&active=shu-affordances-panel");
		// The app activates the query column on start (app.ts), which fires setActivePane BEFORE the first fromHash.
		// That write must be suppressed — writing a still-empty `desired` would delete every col= entry.
		PaneState.setActivePane("query");
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-affordances-panel", "shu-graph-view"]);
		// fromHash then restores both panes (and the remembered active pane), col= intact.
		PaneState.fromHash();
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane"))
			.map((p) => (p as HTMLElement).dataset.columnKey)
			.sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-graph-view"]);
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-affordances-panel", "shu-graph-view"]);
	});

	it("re-request with data updates the live child's products", async () => {
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { forward: [], goals: [] } });
		await flush();
		const child = document.querySelector("shu-column-pane > *") as HTMLElement & { products?: Record<string, unknown> };
		expect(child.products).toEqual({ forward: [], goals: [] });
	});

	it("malformed col= entries are skipped, not crashed-on", async () => {
		ShuElement.pushHash("#?col=Bad+Tag&col=shu-graph-view");
		PaneState.fromHash();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-graph-view"]);
	});

	it("dismiss after open rewrites the hash so the closed pane's col= entry is gone", async () => {
		PaneState.fromHash(); // hydrate — production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		PaneState.request({ paneType: "component", tag: "shu-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-graph-view", "shu-monitor-column"]);
		PaneState.dismiss("shu-graph-view");
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col")).toEqual(["shu-monitor-column"]);
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
	});

	it("rapid concurrent requests never duplicate a pane (race regression)", async () => {
		// Reconcile is async (awaits ensureLoaded / afterAttach). Until the in-flight
		// pass settles, more requests must NOT start a parallel reconcile.
		for (let i = 0; i < 6; i++) {
			PaneState.request({ paneType: "component", tag: `shu-graph-view`, label: "G" });
			PaneState.request({ paneType: "component", tag: `shu-monitor-column`, label: "M" });
		}
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		expect(panes).toHaveLength(2);
		expect(panes.map((p) => p.dataset.columnKey).sort()).toEqual(["shu-graph-view", "shu-monitor-column"]);
	});

	it("reload-style fromHash with many col= entries never creates duplicates", async () => {
		ShuElement.pushHash("#?col=shu-graph-view&col=shu-monitor-column&col=shu-affordances-panel&col=shu-graph-view&col=shu-monitor-column");
		PaneState.fromHash();
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		const ids = panes.map((p) => p.dataset.columnKey).sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-graph-view", "shu-monitor-column"]);
	});

	it("entity pane request → derived id, fires afterAttach hook", async () => {
		let opened: { id: string; label: string } | null = null;
		// biome-ignore lint/suspicious/noExplicitAny: test-only — strip facade is narrower than real ShuColumnStrip.
		PaneState.init(document.querySelector("shu-column-strip") as any, {
			afterAttach: {
				entity: (d) => {
					if (d.paneType === "entity") opened = { id: d.id, label: d.persistedAs };
				},
			},
		});
		PaneState.request({ paneType: "entity", persistedAs: "Email", id: "msg-1" });
		await flush();
		expect(opened).toEqual({ id: "msg-1", label: "Email" });
		const pane = document.querySelector("shu-column-pane") as HTMLElement | null;
		expect(pane?.dataset.columnKey).toBe("e:Email:msg-1");
	});

	it("requestFrom prunes every non-pinned pane to the right of the source (pane tracked + hash updated)", async () => {
		PaneState.fromHash(); // hydrate — production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		PaneState.request({ paneType: "component", tag: "shu-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(3);
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-graph-view") as HTMLElement;
		// Pass the source pane element directly. This is the path the app uses when it can hand the originating row/button to PaneState — closest("shu-column-pane") resolves synchronously without depending on Event.composedPath validity.
		PaneState.requestFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-1" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-graph-view", "e:Email:msg-1"]);
		// And the URL hash (single source of truth for cross-reload column state) reflects the pruned set.
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-graph-view", "e:Email:msg-1"]);
	});

	it("requestFrom from a child element inside the source pane prunes via element.closest", async () => {
		PaneState.request({ paneType: "component", tag: "shu-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-graph-view") as HTMLElement;
		const inner = document.createElement("button");
		graphPane.appendChild(inner);
		PaneState.requestFrom(inner, { paneType: "entity", persistedAs: "Email", id: "msg-x" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-graph-view", "e:Email:msg-x"]);
	});

	it("requestFrom honours pinned panes and addToSelection skips the prune (hash kept in sync)", async () => {
		PaneState.fromHash(); // hydrate — production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		PaneState.request({ paneType: "component", tag: "shu-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		const monitor = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-monitor-column") as HTMLElement;
		monitor.setAttribute("pinned", "true");
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-graph-view") as HTMLElement;

		PaneState.requestFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-2" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		// Pinned monitor survives; non-pinned affordances-panel that was to the right is dismissed.
		expect(ids).toContain("shu-graph-view");
		expect(ids).toContain("shu-monitor-column");
		expect(ids).toContain("e:Email:msg-2");
		expect(ids).not.toContain("shu-affordances-panel");
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).not.toContain("shu-affordances-panel");
		expect(cols).toContain("shu-monitor-column");
		expect(cols).toContain("e:Email:msg-2");

		// addToSelection: do NOT prune anything; the existing entity column survives alongside the new one.
		PaneState.requestFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-3" }, true);
		await flush();
		const afterAdd = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(afterAdd).toContain("e:Email:msg-2");
		expect(afterAdd).toContain("e:Email:msg-3");
	});
});
