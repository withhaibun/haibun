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
import { setConduit, resetConduit, LiveConduit } from "./hypermedia.js";
import { TestConduit } from "./test-setup.js";

/** Offline is which Conduit is installed: a serialized one has no location to mutate, a live one does. */
const offline = () => setConduit(new TestConduit(() => { throw new Error("pane-state test: no dispatch expected"); }));

const emptyMeta = (ui: SiteMetadata["ui"] = {}): SiteMetadata => ({
	types: [],
	idFields: {},
	rels: {},
	edgeRanges: {},
	properties: {},
	queryable: {},
	validTimeFields: {},
	summary: {},
	ui,
	propertyDefinitions: {},
});

describe("derived helpers", () => {
	it("paneIdOf is unique per variant data", () => {
		expect(paneIdOf({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" })).toBe("shu-polymorphic-graph-view");
		expect(paneIdOf({ paneType: "entity", id: "msg-1", persistedAs: "Email" })).toBe("e:Email:msg-1");
		expect(paneIdOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" })).toBe("f:Email:from=a@b");
		expect(paneIdOf({ paneType: "thread", persistedAs: "Email", subject: "msg-42" })).toBe("t:Email:msg-42");
		expect(paneIdOf({ paneType: "type", persistedAs: "Issuer" })).toBe("type:Issuer");
		expect(paneIdOf({ paneType: "step-detail", seqPath: [0, 1, 2] })).toBe("step:0.1.2");
	});

	it("an entity pane of a type whose panel is slotted opens the generic entity column", () => {
		// The petitions panel is declared on Proposal with a slot: it mounts in the permissions area and is about the
		// type. Opening one proposal must not mount that panel as the record's column — it has no `open` to call.
		setSiteMetadata(emptyMeta({ Proposal: { component: "shu-petitions", slot: "permissions" }, Report: { component: "shu-report-column" } }));
		expect(tagOf({ paneType: "entity", id: "p-1", persistedAs: "Proposal" })).toBe("shu-entity-column");
		expect(tagOf({ paneType: "entity", id: "r-1", persistedAs: "Report" })).toBe("shu-report-column");
		setSiteMetadata(emptyMeta());
	});

	it("tagOf maps each paneType to its column-component, components reuse their tag", () => {
		expect(tagOf({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" })).toBe("shu-polymorphic-graph-view");
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
		const d = parseColEntry("shu-polymorphic-graph-view");
		expect(d?.paneType).toBe("component");
		if (d?.paneType === "component") expect(d.tag).toBe("shu-polymorphic-graph-view");
	});

	it("round-trips an entity pane with a flag", () => {
		const d = parseColEntry("e:Email:msg-1~max");
		expect(d?.paneType).toBe("entity");
		expect(d?.flag).toBe("max");
		expect(d && paneIdOf(d)).toBe("e:Email:msg-1");
	});

	it("round-trips a type pane (survives reload; not mistaken for a `t:` thread or a component tag)", () => {
		const d = parseColEntry("type:Issuer");
		expect(d?.paneType).toBe("type");
		if (d?.paneType === "type") expect(d.persistedAs).toBe("Issuer");
		expect(d && paneIdOf(d)).toBe("type:Issuer");
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
		resetConduit();
		offline();
		ShuElement.pushHash("#?");
		if (!customElements.get("shu-column-pane"))
			customElements.define(
				"shu-column-pane",
				class extends HTMLElement {
					setMinimized(m: boolean) {
						this.toggleAttribute("data-minimized", m);
					}
					setMaximized(m: boolean) {
						if (m === this.hasAttribute("data-maximized")) return;
						this.toggleAttribute("data-maximized", m);
						this.dispatchEvent(new CustomEvent("column-maximize", { detail: { maximized: m }, bubbles: true, composed: true }));
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
					applyActive() {
						/* no-op: the active-pane signal painting is not under test here */
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
		if (!customElements.get("shu-polymorphic-graph-view")) customElements.define("shu-polymorphic-graph-view", class extends HTMLElement {});
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
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-monitor-column&active=shu-monitor-column");
		PaneState.fromHash();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	it("a boot column activation BEFORE fromHash must not strip the restored col= views (regression)", async () => {
		// A reloaded URL carries two restored views and a remembered active pane.
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-affordances-panel&active=shu-affordances-panel");
		// The app activates the query column on start (app.ts), which fires setActivePane BEFORE the first fromHash.
		// That write must be suppressed — writing a still-empty `desired` would delete every col= entry.
		PaneState.setActivePane("query");
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
		// fromHash then restores both panes (and the remembered active pane), col= intact.
		PaneState.fromHash();
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane"))
			.map((p) => (p as HTMLElement).dataset.columnKey)
			.sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
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
		ShuElement.pushHash("#?col=Bad+Tag&col=shu-polymorphic-graph-view");
		PaneState.fromHash();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-polymorphic-graph-view"]);
	});

	it("dismiss after open rewrites the hash so the closed pane's col= entry is gone", async () => {
		PaneState.fromHash(); // hydrate — production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		PaneState.request({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
		PaneState.dismiss("shu-polymorphic-graph-view");
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col")).toEqual(["shu-monitor-column"]);
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
	});

	it("rapid concurrent requests never duplicate a pane (race regression)", async () => {
		// Reconcile is async (awaits ensureLoaded / afterAttach). Until the in-flight
		// pass settles, more requests must NOT start a parallel reconcile.
		for (let i = 0; i < 6; i++) {
			PaneState.request({ paneType: "component", tag: `shu-polymorphic-graph-view`, label: "G" });
			PaneState.request({ paneType: "component", tag: `shu-monitor-column`, label: "M" });
		}
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		expect(panes).toHaveLength(2);
		expect(panes.map((p) => p.dataset.columnKey).sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	it("reload-style fromHash with many col= entries never creates duplicates", async () => {
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-monitor-column&col=shu-affordances-panel&col=shu-polymorphic-graph-view&col=shu-monitor-column");
		PaneState.fromHash();
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		const ids = panes.map((p) => p.dataset.columnKey).sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	// Reload restore (the shu-self-test 13.3 affordances flake): on reload the event-stream replays its history and
	// re-`request()`s the open view-panes (app.ts) BEFORE the boot `fromHash` reads the reloaded URL. The restore must
	// be deterministic regardless of that interleave — every col= entry in the reloaded hash mounts, none is dropped.
	const liveIds = () => Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
	const reloadInto = (hash: string): HTMLElement => {
		PaneState.__resetForTests();
		document.body.innerHTML = "";
		const strip = document.createElement("shu-column-strip") as HTMLElement;
		document.body.appendChild(strip);
		ShuElement.pushHash(hash); // the reloaded URL carries the hash from the start
		// biome-ignore lint/suspicious/noExplicitAny: test-only strip facade.
		PaneState.init(strip as any);
		return strip;
	};

	it("reload restores the affordances view-pane from the hash it was written into during the session (13.3)", async () => {
		PaneState.fromHash(); // boot hydration on the empty initial URL
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		const reloadedHash = ShuElement.getHash();
		expect(new URLSearchParams(reloadedHash.slice(2)).getAll("col")).toContain("shu-affordances-panel"); // session hash carries it

		reloadInto(reloadedHash);
		PaneState.fromHash();
		await flush();
		expect(liveIds()).toContain("shu-affordances-panel");
	});

	it("reload boot order: event-replay re-requests view-panes BEFORE the boot fromHash — all hash panes still mount, no drop", async () => {
		const reloadedHash = "#?col=shu-monitor-column&col=shu-polymorphic-graph-view&col=shu-affordances-panel&col=shu-domain-chain-view";
		reloadInto(reloadedHash);
		// the replay fires first, re-opening the same view-panes (app.ts eventStream handler) while hydrated is still false
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		PaneState.request({ paneType: "component", tag: "shu-domain-chain-view", label: "C" });
		await flush();
		PaneState.fromHash(); // then the boot fromHash reads the reloaded URL
		await flush();
		const ids = liveIds().sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-domain-chain-view", "shu-monitor-column", "shu-polymorphic-graph-view"]);
		expect(liveIds().filter((i) => i === "shu-affordances-panel")).toHaveLength(1); // exactly one, no dup
	});

	it("reload re-feed: the replay re-requesting an already-restored pane after fromHash keeps it (no remove/dup)", async () => {
		const reloadedHash = "#?col=shu-monitor-column&col=shu-affordances-panel";
		reloadInto(reloadedHash);
		PaneState.fromHash(); // boot restores from the hash first
		await flush();
		expect(liveIds()).toContain("shu-affordances-panel");
		// the async replay lands afterwards and re-feeds the live pane
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { forward: [], goals: [] } });
		await flush();
		expect(liveIds().filter((i) => i === "shu-affordances-panel")).toHaveLength(1);
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
		PaneState.request({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(3);
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;
		// Pass the source pane element directly. This is the path the app uses when it can hand the originating row/button to PaneState — closest("shu-column-pane") resolves synchronously without depending on Event.composedPath validity.
		PaneState.requestFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-1" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-1"]);
		// And the URL hash (single source of truth for cross-reload column state) reflects the pruned set.
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-1"]);
	});

	it("requestFrom from a child element inside the source pane prunes via element.closest", async () => {
		PaneState.request({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;
		const inner = document.createElement("button");
		graphPane.appendChild(inner);
		PaneState.requestFrom(inner, { paneType: "entity", persistedAs: "Email", id: "msg-x" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-x"]);
	});

	it("requestFrom honours pinned panes and addToSelection skips the prune (hash kept in sync)", async () => {
		PaneState.fromHash(); // hydrate — production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		PaneState.request({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		PaneState.request({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		const monitor = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-monitor-column") as HTMLElement;
		monitor.setAttribute("pinned", "true");
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;

		PaneState.requestFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-2" });
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		// Pinned monitor survives; non-pinned affordances-panel that was to the right is dismissed.
		expect(ids).toContain("shu-polymorphic-graph-view");
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

	it("an open= link adds its pane to the live state instead of replacing it (a document's view link)", async () => {
		// Online: the arrival path is a real location change, canonicalized by view-hash's ingress listener
		// (registered at import, so it runs before PaneState's) before any consumer reads the hash.
		resetConduit();
		setConduit(new LiveConduit(""));
		ShuElement.pushHash("#?label=File&sort=dateModified&col=shu-monitor-column&active=shu-monitor-column");
		PaneState.fromHash();
		await flush();

		// A document link cannot know the live state, so it names only the pane it opens. replaceState +
		// a dispatched hashchange is the arrival without jsdom's own async echo.
		history.replaceState(null, "", "#?open=shu-polymorphic-graph-view");
		window.dispatchEvent(new HashChangeEvent("hashchange"));
		await flush();

		const params = ViewHash.hashParams(ShuElement.getHash());
		expect(params.get("label")).toBe("File"); // the query state survives the link
		expect(params.get("sort")).toBe("dateModified");
		expect(params.getAll("col").sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
		expect(params.get("active")).toBe("shu-polymorphic-graph-view"); // the linked view is what the reader asked for
		expect(params.get("open")).toBeNull(); // canonicalized away
		resetConduit();
		offline();
	});
});
