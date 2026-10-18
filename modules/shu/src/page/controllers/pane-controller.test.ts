// @vitest-environment jsdom
/**
 * The page's panes, as the pane controller opens, closes and restores them on a strip.
 *
 * Pinned invariants: idempotency, hash round-trip, dedup-by-derived-id, and
 * malformed col= entries are skipped (never crashed-on).
 */
import { type TCatalogSpec, declareCatalog, declareSpec } from "../../test/catalog-fixture.js";
import { buildConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { seqPathDomainDefinition } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { SHU_TAG } from "../../domains/elements.js";
import { requiredActionOf } from "./registry-controller.js";
import { describe, it, expect, beforeEach } from "vitest";
import { FRAGMENT_SPEC } from "@haibun/core/lib/domains/media-fragments.js";
import { ShuElement } from "../components/shu-element.js";
import * as Address from "../derivations/address.js";
import { installConduit, installServedConduit } from "../root.js";
import { TestConduit, newPage } from "../../test/setup.js";
import { IMPORTED_VIEWS } from "../../test/pane-requests.js";
import type { TStripElement } from "../ports.js";
import { activePane } from "../root.js";
import { PANE_CONTEXT, paneOfEntry, activatePane, dismissPane, openStrip, requestPane, requestPaneFrom, restorePanes } from "./pane-controller.js";
import { columnEntryOf, DesiredPaneSchema, paneIdOf, tagOf, labelOf } from "../derivations/pane-kinds.js";

/** Offline is which TConduit is installed: a serialized one doesn't have a location to mutate, a live one does. */
const offline = () =>
	installConduit(
		new TestConduit(() => {
			throw new Error("the pane controller test doesn't expect a dispatch");
		}),
	);

const emptyMeta = (ui: TCatalogSpec["ui"] = {}): TCatalogSpec => ({ types: [], idFields: {}, rels: {}, edgeRanges: {}, queryable: {}, validTimeFields: {}, ui });

describe("derived helpers", () => {
	it("paneIdOf is unique per variant data", () => {
		expect(paneIdOf({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" })).toBe("shu-polymorphic-graph-view");
		expect(paneIdOf({ paneType: "entity", id: "msg-1", persistedAs: "Email" })).toBe("e:Email:msg-1");
		expect(paneIdOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" })).toBe("f:Email:from=a@b");
		expect(paneIdOf({ paneType: "thread", persistedAs: "Email", subject: "msg-42" })).toBe("t:Email:msg-42");
		expect(paneIdOf({ paneType: "type", persistedAs: "Issuer" })).toBe("type:Issuer");
	});

	it("an entity pane of a type whose panel is slotted opens the generic entity column", () => {
		// The petitions panel is declared on Proposal with a slot: it mounts in the permissions area and is about the
		// type. Opening one proposal must not mount that panel as the record's column: it doesn't have an `open` to call.
		declareSpec(emptyMeta({ Proposal: { component: "shu-petitions", slot: "permissions" }, Report: { component: "shu-report-column" } }));
		expect(tagOf({ paneType: "entity", id: "p-1", persistedAs: "Proposal" }, PANE_CONTEXT)).toBe("shu-entity-column");
		expect(tagOf({ paneType: "entity", id: "r-1", persistedAs: "Report" }, PANE_CONTEXT)).toBe("shu-report-column");
		declareSpec(emptyMeta());
	});

	it("opens a step's address as its SeqPath record, in the view SeqPath's declaration names (CA4D9)", () => {
		declareCatalog(buildConcernCatalog(mapDefinitionsToDomains([seqPathDomainDefinition])));
		const step = paneOfEntry("e:SeqPath:1790000000000-1.0.1.2");
		expect(step).toEqual({ paneType: "entity", persistedAs: SEQ_PATH_LABEL, id: "1790000000000-1.0.1.2" });
		expect(step === null ? undefined : tagOf(step, PANE_CONTEXT)).toBe(SHU_TAG.STEP_DETAIL);
		declareSpec(emptyMeta());
	});

	it("tagOf maps each paneType to its column-component, components reuse their tag", () => {
		expect(tagOf({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" }, PANE_CONTEXT)).toBe("shu-polymorphic-graph-view");
		expect(tagOf({ paneType: "entity", id: "x", persistedAs: "Email" }, PANE_CONTEXT)).toBe("shu-entity-column");
		expect(tagOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "p", value: "v" }, PANE_CONTEXT)).toBe("shu-filter-column");
		expect(tagOf({ paneType: "thread", persistedAs: "Email", subject: "s" }, PANE_CONTEXT)).toBe("shu-thread-column");
	});

	it("an entity opens its @type's declared column component, defaulting to the generic entity column", () => {
		declareSpec(emptyMeta({ Task: { component: "shu-task-column" } }));
		expect(tagOf({ paneType: "entity", id: "t1", persistedAs: "Task" }, PANE_CONTEXT)).toBe("shu-task-column"); // @type declares its own column
		expect(tagOf({ paneType: "entity", id: "e1", persistedAs: "Email" }, PANE_CONTEXT)).toBe("shu-entity-column"); // a column isn't declared → generic
		declareSpec(emptyMeta()); // reset so other tests don't see a per-type ui
	});

	it("labelOf derives a display label per variant", () => {
		expect(labelOf({ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@b" })).toBe("from=a@b");
		expect(labelOf({ paneType: "entity", id: "msg-1", persistedAs: "Email" })).toBe("msg-1");
		expect(labelOf({ paneType: "entity", id: "msg-1", persistedAs: "Email", label: "Override" })).toBe("Override");
	});
});

describe("a column entry", () => {
	it("round-trips a component pane", () => {
		const d = paneOfEntry("shu-polymorphic-graph-view");
		expect(d?.paneType).toBe("component");
		if (d?.paneType === "component") expect(d.tag).toBe("shu-polymorphic-graph-view");
	});

	it("round-trips an entity pane with a flag", () => {
		const d = paneOfEntry("e:Email:msg-1~max");
		expect(d?.paneType).toBe("entity");
		expect(d?.flag).toBe("max");
		expect(d && paneIdOf(d)).toBe("e:Email:msg-1");
	});

	it("round-trips an entity pane at a part: a passage it quotes, or a page of its media", () => {
		for (const selector of [{ exact: "the back door" }, { conformsTo: FRAGMENT_SPEC.pdf, value: "page=2" }]) {
			const entry = columnEntryOf({ paneType: "entity", persistedAs: "File", id: "f-1", selector });
			const d = paneOfEntry(entry);
			expect(d?.paneType === "entity" && d.selector, entry).toEqual(selector);
			expect(d && paneIdOf(d), "the part isn't the pane's identity").toBe("e:File:f-1");
		}
	});

	it("reads where a pane stands from its entry's endings, in either order", () => {
		for (const raw of ["shu-monitor-column~dock~min", "shu-monitor-column~min~dock"]) {
			const d = paneOfEntry(raw);
			expect(d?.docked, raw).toBe(true);
			expect(d?.flag, raw).toBe("min");
			expect(d && paneIdOf(d), raw).toBe("shu-monitor-column");
		}
		expect(paneOfEntry("shu-monitor-column")?.docked).toBeUndefined();
	});

	it("round-trips a type pane (survives reload; not mistaken for a `t:` thread or a component tag)", () => {
		const d = paneOfEntry("type:Issuer");
		expect(d?.paneType).toBe("type");
		if (d?.paneType === "type") expect(d.persistedAs).toBe("Issuer");
		expect(d && paneIdOf(d)).toBe("type:Issuer");
	});

	it("returns null for malformed entries", () => {
		expect(paneOfEntry("e:")).toBeNull();
		expect(paneOfEntry("Bad Tag")).toBeNull();
		expect(paneOfEntry("step:not.a.number")).toBeNull();
	});

	it("rejects components with uppercase or whitespace", () => {
		expect(paneOfEntry("ShuGraphView")).toBeNull();
		expect(paneOfEntry("shu graph")).toBeNull();
	});

	it("DesiredPaneSchema rejects unknown paneType", () => {
		expect(() => DesiredPaneSchema.parse({ paneType: "unknown" })).toThrow();
	});
});

describe("the page's panes", () => {
	/** A page loaded again: it doesn't hold the last page's panes, boot installs its conduit, and it reads its registry. */
	const reloadPage = () => {
		newPage();
		declareSpec(emptyMeta());
		offline();
		activePane.set(null);
	};
	beforeEach(() => {
		reloadPage();
		activePane.set(null);
		document.body.innerHTML = "";
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
					get docked(): boolean {
						return this.hasAttribute("docked");
					}
					setDocked(d: boolean) {
						this.toggleAttribute("docked", d);
					}
					setPinned(p: boolean) {
						this.toggleAttribute("pinned", p);
					}
					close() {
						this.toggleAttribute("collapsed", this.hasAttribute("docked"));
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
					layoutColumns() {
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
		// biome-ignore lint/suspicious/noExplicitAny: test-only, strip facade is narrower than real ShuColumnStrip.
		openStrip(strip as any, IMPORTED_VIEWS, []);
	});

	/** Waits for a task, by which each microtask of a reconcile, its loads and its views' definitions has run. */
	const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

	it("request creates exactly one pane per derived id; re-request is idempotent", async () => {
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
	});

	it("dismiss removes the pane and the col= entry from the hash", async () => {
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
		dismissPane("shu-monitor-column");
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(0);
		expect(ShuElement.getHash()).not.toMatch(/col=shu-monitor-column/);
	});

	it("hash round-trip preserves the col= set", async () => {
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-monitor-column&active=shu-monitor-column");
		restorePanes();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	it("a boot column activation BEFORE fromHash must not strip the restored col= views (regression)", async () => {
		// A reloaded URL carries two restored views and a remembered active pane.
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-affordances-panel&active=shu-affordances-panel");
		// The app activates the query column on start (app.ts), which fires setActivePane BEFORE the first fromHash.
		// That write must be suppressed, writing a still-empty `desired` would delete every col= entry.
		activatePane("query");
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
		// fromHash then restores both panes (and the remembered active pane), col= intact.
		restorePanes();
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane"))
			.map((p) => (p as HTMLElement).dataset.columnKey)
			.sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort();
		expect(cols).toEqual(["shu-affordances-panel", "shu-polymorphic-graph-view"]);
	});

	it("re-request with data updates the live child's products", async () => {
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { satisfiedDomains: [], forward: [], goals: [] } });
		await flush();
		const child = document.querySelector("shu-column-pane > *") as HTMLElement & { products?: Record<string, unknown> };
		expect(child.products).toEqual({ satisfiedDomains: [], forward: [], goals: [] });
	});

	it("malformed col= entries are skipped, not crashed-on", async () => {
		ShuElement.pushHash("#?col=Bad+Tag&col=shu-polymorphic-graph-view");
		restorePanes();
		await flush();
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-polymorphic-graph-view"]);
	});

	it("dismiss after open rewrites the hash so the closed pane's col= entry is gone", async () => {
		restorePanes(); // hydrate, production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col").sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
		dismissPane("shu-polymorphic-graph-view");
		await flush();
		expect(new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col")).toEqual(["shu-monitor-column"]);
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(1);
	});

	it("rapid concurrent requests never duplicate a pane (race regression)", async () => {
		// Reconcile is async (awaits ensureLoaded / afterAttach). Until the in-flight
		// pass settles, more requests must NOT start a parallel reconcile.
		for (let i = 0; i < 6; i++) {
			requestPane({ paneType: "component", tag: `shu-polymorphic-graph-view`, label: "G" });
			requestPane({ paneType: "component", tag: `shu-monitor-column`, label: "M" });
		}
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		expect(panes).toHaveLength(2);
		expect(panes.map((p) => p.dataset.columnKey).sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	it("reload-style fromHash with many col= entries never creates duplicates", async () => {
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-monitor-column&col=shu-affordances-panel&col=shu-polymorphic-graph-view&col=shu-monitor-column");
		restorePanes();
		await flush();
		const panes = Array.from(document.querySelectorAll("shu-column-pane")) as HTMLElement[];
		const ids = panes.map((p) => p.dataset.columnKey).sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-monitor-column", "shu-polymorphic-graph-view"]);
	});

	// Reload restore (the shu-self-test 13.3 affordances flake): on reload an early view request (a step's products arriving before the hash is read) and
	// re-`request()`s the open view-panes (app.ts) BEFORE the boot `fromHash` reads the reloaded URL. The restore must
	// be deterministic regardless of that interleave: every col= entry in the reloaded hash mounts, and the restore doesn't drop one.
	const liveIds = () => Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
	const reloadInto = (hash: string): HTMLElement => {
		reloadPage();
		document.body.innerHTML = "";
		const strip = document.createElement("shu-column-strip") as HTMLElement;
		document.body.appendChild(strip);
		ShuElement.pushHash(hash); // the reloaded URL carries the hash from the start
		// biome-ignore lint/suspicious/noExplicitAny: test-only strip facade.
		openStrip(strip as any, IMPORTED_VIEWS, []);
		return strip;
	};

	it("reload restores the affordances view-pane from the hash it was written into during the session (13.3)", async () => {
		restorePanes(); // boot hydration on the empty initial URL
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		const reloadedHash = ShuElement.getHash();
		expect(new URLSearchParams(reloadedHash.slice(2)).getAll("col")).toContain("shu-affordances-panel"); // session hash carries it

		reloadInto(reloadedHash);
		restorePanes();
		await flush();
		expect(liveIds()).toContain("shu-affordances-panel");
	});

	it("reload boot order: an early view request re-requests view-panes BEFORE the boot fromHash: all hash panes still mount without a drop", async () => {
		const reloadedHash = "#?col=shu-monitor-column&col=shu-polymorphic-graph-view&col=shu-affordances-panel&col=shu-domain-chain-view";
		reloadInto(reloadedHash);
		// the early request fires first, re-opening the same view-panes (app.ts eventStream handler) while hydrated is still false
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		requestPane({ paneType: "component", tag: "shu-domain-chain-view", label: "C" });
		await flush();
		restorePanes(); // then the boot fromHash reads the reloaded URL
		await flush();
		const ids = liveIds().sort();
		expect(ids).toEqual(["shu-affordances-panel", "shu-domain-chain-view", "shu-monitor-column", "shu-polymorphic-graph-view"]);
		expect(liveIds().filter((i) => i === "shu-affordances-panel")).toHaveLength(1); // exactly one, without a dup
	});

	it("reload re-feed: an event re-requesting an already-restored pane after fromHash keeps it (without a remove/dup)", async () => {
		const reloadedHash = "#?col=shu-monitor-column&col=shu-affordances-panel";
		reloadInto(reloadedHash);
		restorePanes(); // boot restores from the hash first
		await flush();
		expect(liveIds()).toContain("shu-affordances-panel");
		// the event lands afterwards and re-feeds the live pane
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A", data: { satisfiedDomains: [], forward: [], goals: [] } });
		await flush();
		expect(liveIds().filter((i) => i === "shu-affordances-panel")).toHaveLength(1);
	});

	it("entity pane request → derived id, fires afterAttach hook", async () => {
		let opened: { id: string; label: string } | null = null;
		openStrip(
			document.querySelector("shu-column-strip") as unknown as TStripElement,
			{
				load: () => Promise.resolve(),
				attach: {
					entity: (d) => {
						opened = { id: d.id, label: d.persistedAs };
					},
				},
			},
			[],
		);
		requestPane({ paneType: "entity", persistedAs: "Email", id: "msg-1" });
		await flush();
		expect(opened).toEqual({ id: "msg-1", label: "Email" });
		const pane = document.querySelector("shu-column-pane") as HTMLElement | null;
		expect(pane?.dataset.columnKey).toBe("e:Email:msg-1");
	});

	it("requestFrom prunes every non-pinned pane to the right of the source (pane tracked + hash updated)", async () => {
		restorePanes(); // hydrate, production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		expect(document.querySelectorAll("shu-column-pane")).toHaveLength(3);
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;
		// Pass the source pane element directly. This is the path the app uses when it can hand the originating row/button to the pane controller, closest("shu-column-pane") resolves synchronously without depending on Event.composedPath validity.
		requestPaneFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-1" }, false);
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-1"]);
		// And the URL hash (single source of truth for cross-reload column state) reflects the pruned set.
		const cols = new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
		expect(cols).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-1"]);
	});

	it("requestFrom from a child element inside the source pane prunes via element.closest", async () => {
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;
		const inner = document.createElement("button");
		graphPane.appendChild(inner);
		requestPaneFrom(inner, { paneType: "entity", persistedAs: "Email", id: "msg-x" }, false);
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-polymorphic-graph-view", "e:Email:msg-x"]);
	});

	it("requestFrom honours pinned panes and addToSelection skips the prune (hash kept in sync)", async () => {
		restorePanes(); // hydrate, production reads the reloaded hash on boot before any runtime open (writeHash is gated until then)
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		requestPane({ paneType: "component", tag: "shu-affordances-panel", label: "A" });
		await flush();
		const monitor = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-monitor-column") as HTMLElement;
		monitor.setAttribute("pinned", "true");
		const graphPane = Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === "shu-polymorphic-graph-view") as HTMLElement;

		requestPaneFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-2" }, false);
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
		requestPaneFrom(graphPane, { paneType: "entity", persistedAs: "Email", id: "msg-3" }, true);
		await flush();
		const afterAdd = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(afterAdd).toContain("e:Email:msg-2");
		expect(afterAdd).toContain("e:Email:msg-3");
	});

	const paneKeyed = (key: string) => Array.from(document.querySelectorAll("shu-column-pane")).find((p) => (p as HTMLElement).dataset.columnKey === key) as HTMLElement;
	const cols = () => new URLSearchParams(ShuElement.getHash().slice(2)).getAll("col");
	const dock = (key: string, docked: boolean) => paneKeyed(key).dispatchEvent(new CustomEvent("column-dock", { detail: { docked }, bubbles: true, composed: true }));

	/** A page with the affordances panel as its pane, docked as declared and labelled Actions. */
	const withPagePane = () => {
		const strip = document.querySelector("shu-column-strip");
		reloadPage();
		// biome-ignore lint/suspicious/noExplicitAny: test-only, strip facade is narrower than real ShuColumnStrip.
		openStrip(strip as any, IMPORTED_VIEWS, [{ pane: { paneType: "component", tag: "shu-affordances-panel", label: "Actions", docked: true }, attributes: {} }]);
	};

	it("docks a pane in the address, and docking another returns the first to the strip", async () => {
		restorePanes();
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		requestPane({ paneType: "component", tag: "shu-polymorphic-graph-view", label: "G" });
		await flush();
		dock("shu-monitor-column", true);
		await flush();
		expect(cols()).toEqual(["shu-monitor-column~dock", "shu-polymorphic-graph-view"]);
		expect(paneKeyed("shu-monitor-column").hasAttribute("docked")).toBe(true);
		dock("shu-polymorphic-graph-view", true);
		await flush();
		expect(cols(), "one pane is docked at a time").toEqual(["shu-monitor-column", "shu-polymorphic-graph-view~dock"]);
		expect(paneKeyed("shu-monitor-column").hasAttribute("docked"), "the first pane is back in the strip").toBe(false);
		expect(paneKeyed("shu-polymorphic-graph-view").hasAttribute("docked")).toBe(true);
	});

	it("keeps a pane a reload names docked docked, and a re-request leaves it docked", async () => {
		ShuElement.pushHash("#?col=shu-monitor-column~dock");
		restorePanes();
		await flush();
		expect(paneKeyed("shu-monitor-column").hasAttribute("docked")).toBe(true);
		requestPane({ paneType: "component", tag: "shu-monitor-column", label: "M" });
		await flush();
		expect(cols()).toEqual(["shu-monitor-column~dock"]);
	});

	it("holds a page pane as declared where the address doesn't name it, and names it in the address only where it stands otherwise", async () => {
		const strip = document.querySelector("shu-column-strip");
		reloadPage();
		// biome-ignore lint/suspicious/noExplicitAny: test-only, strip facade is narrower than real ShuColumnStrip.
		openStrip(strip as any, IMPORTED_VIEWS, [
			{ pane: { paneType: "component", tag: "shu-affordances-panel", label: "Actions", docked: true }, attributes: { "testid-prefix": "app-" } },
		]);
		restorePanes();
		await flush();
		const page = paneKeyed("shu-affordances-panel");
		expect(page.hasAttribute("docked"), "docked, as declared").toBe(true);
		expect(page.getAttribute("closable"), "and it doesn't offer a close, since the page holds it either way").toBe("false");
		expect(page.firstElementChild?.getAttribute("testid-prefix"), "its view has the attributes declared for it").toBe("app-");
		expect(cols(), "the address doesn't name a page pane that stands as declared").toEqual([]);
		dock("shu-affordances-panel", false);
		await flush();
		expect(cols(), "a page pane returned to the strip is named").toEqual(["shu-affordances-panel"]);
		ShuElement.pushHash("#?");
		restorePanes();
		await flush();
		expect(paneKeyed("shu-affordances-panel").hasAttribute("docked"), "an address that doesn't name it docks it again").toBe(true);
	});

	it("doesn't make a page pane active, at a reload or when the active pane closes", async () => {
		withPagePane();
		ShuElement.pushHash("#?col=shu-monitor-column");
		restorePanes();
		await flush();
		expect(activePane.get()).toBe("shu-monitor-column");
		dismissPane("shu-monitor-column");
		await flush();
		expect(activePane.get(), "the page pane isn't the pane left active").toBeNull();
	});

	it("a prune leaves a docked pane, and returns a page pane it closes to its place", async () => {
		withPagePane();
		ShuElement.pushHash("#?col=shu-polymorphic-graph-view&col=shu-monitor-column&col=shu-affordances-panel");
		restorePanes();
		await flush();
		dock("shu-monitor-column", true);
		await flush();
		requestPaneFrom(paneKeyed("shu-polymorphic-graph-view"), { paneType: "entity", persistedAs: "Email", id: "msg-4" }, false);
		await flush();
		const ids = Array.from(document.querySelectorAll("shu-column-pane")).map((p) => (p as HTMLElement).dataset.columnKey);
		expect(ids).toEqual(["shu-polymorphic-graph-view", "shu-monitor-column", "shu-affordances-panel", "e:Email:msg-4"]);
		expect(paneKeyed("shu-affordances-panel").hasAttribute("docked"), "the page pane is docked again").toBe(true);
		expect(paneKeyed("shu-monitor-column").hasAttribute("docked"), "and the pane docked before it is back in the strip").toBe(false);
	});

	it("returns a page pane the page closes to where it declares it, closed and unpinned, and returns the pane docked there to the strip", async () => {
		withPagePane();
		ShuElement.pushHash("#?col=shu-monitor-column&col=shu-affordances-panel");
		restorePanes();
		await flush();
		const page = paneKeyed("shu-affordances-panel");
		expect(page.getAttribute("label"), "an address that names a page pane keeps the label the page declares").toBe("Actions");
		dock("shu-monitor-column", true);
		await flush();
		page.toggleAttribute("pinned", true);
		dismissPane("shu-affordances-panel");
		await flush();
		expect(page.isConnected, "it stays in the page").toBe(true);
		expect(page.hasAttribute("docked"), "docked, as declared").toBe(true);
		expect(page.hasAttribute("pinned"), "and unpinned").toBe(false);
		expect(paneKeyed("shu-monitor-column").hasAttribute("docked"), "the pane docked before it returns to the strip").toBe(false);
		expect(cols(), "the address doesn't name the page pane").toEqual(["shu-monitor-column"]);
		page.toggleAttribute("collapsed", false);
		dismissPane("shu-affordances-panel");
		await flush();
		expect(page.hasAttribute("collapsed"), "a page pane closed where it docks closes to its strip").toBe(true);
	});

	it("an open= link adds its pane to the live state instead of replacing it (a document's view link)", async () => {
		// Online: the arrival path is a real location change, canonicalized by view-hash's ingress listener
		// (registered at import, so it runs before the pane controller's) before any consumer reads the hash.
		reloadPage();
		installServedConduit("", requiredActionOf);
		ShuElement.pushHash("#?label=File&sort=dateModified&col=shu-monitor-column&active=shu-monitor-column");
		restorePanes();
		await flush();

		// A document link doesn't hold the live state, so it names only the pane it opens. replaceState +
		// a dispatched hashchange is the arrival without jsdom's own async echo.
		history.replaceState(null, "", "#?open=shu-polymorphic-graph-view");
		window.dispatchEvent(new HashChangeEvent("hashchange"));
		await flush();

		const params = Address.hashParams(ShuElement.getHash());
		expect(params.get("label")).toBe("File"); // the query state survives the link
		expect(params.get("sort")).toBe("dateModified");
		expect(params.getAll("col").sort()).toEqual(["shu-monitor-column", "shu-polymorphic-graph-view"]);
		expect(params.get("active")).toBe("shu-polymorphic-graph-view"); // the linked view is what the reader asked for
		expect(params.get("open")).toBeNull(); // canonicalized away
		reloadPage();
		offline();
	});
});
