/**
 * Single source of truth for which panes are open.
 *
 * All pane-creation paths, URL-hash restoration, step invocation, toolbar, hash
 * navigation: call `request()` / `dismiss()`. The reconciler is the only thing
 * that creates or destroys panes, so duplicates can't enter the system.
 *
 *   URL hash         ──┐
 *   step invocation  ──┼──► request / dismiss ──► reconcile ──► strip + hash
 *   toolbar          ──┘
 *
 * Each `DesiredPane` carries only the variant's identifying data; the reconciler
 * derives the dedup id, the child tag, and the display label from the variant
 * via `paneIdOf` / `tagOf` / `labelOf`. No redundant fields, no drift.
 */
import { QuoteAnchorSchema, type TQuoteAnchor } from "@haibun/core/lib/resources.js";
import { z } from "zod";
import * as ViewHash from "./view-hash.js";
import { objectId } from "./object-id.js";
import { INDEX_PANE_KEY, SHU_ATTR, SHU_EVENT } from "./consts.js";
import { readShowControlsCookie } from "./show-controls.js";
import { readElementPrefs } from "./element-prefs.js";
import { presentationForType } from "./graph/type-presentation.js";
import { activePane } from "./signals.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";

const FlagSchema = z.enum(["min", "max"]).optional();
const TagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const DesiredPaneSchema = z.discriminatedUnion("paneType", [
	z.object({ paneType: z.literal("component"), tag: TagSchema, label: z.string(), data: z.record(z.string(), z.unknown()).optional(), flag: FlagSchema }),
	z.object({
		paneType: z.literal("entity"),
		id: z.string(),
		persistedAs: z.string(),
		label: z.string().optional(),
		// A quoted passage to reveal inside the individual (TextQuoteSelector shape). Not part of the pane's identity:
		// the pane is the individual, and a second reference into the same document reuses its column.
		selector: QuoteAnchorSchema.optional(),
		flag: FlagSchema,
	}),
	z.object({ paneType: z.literal("type"), persistedAs: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-eq"), persistedAs: z.string(), predicate: z.string(), value: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-prop"), persistedAs: z.string(), predicate: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-incoming"), persistedAs: z.string(), subject: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("thread"), persistedAs: z.string(), subject: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("step-detail"), seqPath: z.array(z.number()), flag: FlagSchema }),
	z.object({
		paneType: z.literal("views-picker"),
		views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })),
		label: z.string(),
		flag: FlagSchema,
	}),
]);

export type DesiredPane = z.infer<typeof DesiredPaneSchema>;
export type DesiredPaneType = DesiredPane["paneType"];

export function paneIdOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
			return d.tag;
		case "entity":
			return `e:${objectId(d.persistedAs, d.id)}`; // the entity pane's id IS the object handle, prefixed by pane kind
		case "type":
			return `type:${d.persistedAs}`;
		case "filter-eq":
			return `f:${d.persistedAs}:${d.predicate}=${d.value}`;
		case "filter-prop":
			return `p:${d.persistedAs}:${d.predicate}`;
		case "filter-incoming":
			return `i:${d.persistedAs}:${d.subject}`;
		case "thread":
			return `t:${d.persistedAs}:${d.subject}`;
		case "step-detail":
			return `step:${d.seqPath.join(".")}`;
		case "views-picker":
			return "views";
	}
}

export function tagOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
			return d.tag;
		case "entity":
			// A node's @type can declare its own column component (via the per-@type presentation facade, domain.ui.component);
			// otherwise the generic entity column. So a typed node opens its type-specific column on a graph/row click.
			return presentationForType(d.persistedAs).columnComponent() ?? "shu-entity-column";
		case "type":
			return "shu-type-column";
		case "filter-eq":
		case "filter-prop":
		case "filter-incoming":
			return "shu-filter-column";
		case "thread":
			return "shu-thread-column";
		case "step-detail":
			return "shu-step-detail";
		case "views-picker":
			return "shu-views-picker";
	}
}

export function labelOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
		case "views-picker":
			return d.label;
		case "entity":
			return d.label ?? d.id;
		case "type":
			return d.persistedAs;
		case "filter-eq":
			return `${d.predicate}=${d.value}`;
		case "filter-prop":
			return d.predicate;
		case "filter-incoming":
			return `links to ${d.subject}`;
		case "thread":
			return `Replies: ${d.subject}`;
		case "step-detail":
			return `Step [${d.seqPath.join(".")}]`;
	}
}

/**
 * Per-paneType post-attach hook. Each parametric pane (entity, filter, ...) needs
 * to call `.open(...)` on its freshly-created child. Keyed by `paneType` so a new
 * variant means one schema entry + one hook: no central switch.
 *
 * `paneType: "component"` needs no hook (data flows via `data`). External component
 * loading also lives here so pane-state has no direct registry dependency.
 */
export type PaneHooks = {
	ensureLoaded?(tag: string): Promise<void> | void;
	afterAttach?: Partial<Record<DesiredPaneType, (d: DesiredPane, child: HTMLElement) => Promise<void> | void>>;
};

class PaneStateImpl {
	private desired = new Map<string, DesiredPane>();
	private strip: ShuColumnStrip | null = null;
	private hooks: PaneHooks = {};
	// The active pane is the global `activePane` signal: the one source of truth every reader (strip styling, harvest,
	// isActiveView, dimming) derives from. PaneState is its writer on restore/open/dismiss; the strip subscribes and
	// paints the DOM `active` state, so activation is never a side effect of appending a pane.
	private get activePaneId(): string | null {
		return activePane.get();
	}
	private set activePaneId(id: string | null) {
		activePane.set(id);
	}
	// The last hash this pushed. The resulting `hashchange` echoes back into fromHash, which rebuilds `desired` from the
	// hash: but a self-write's hash already matches `desired`, and re-reading it mid-mutation (e.g. an activation that
	// fires while a column is opening) clobbers the in-flight pane. So fromHash ignores its own writes and reacts only
	// to EXTERNAL hash changes (back/forward, a shared link).
	private lastWrittenHash: string | null = null;
	// PaneState must READ the hash (fromHash) before it WRITES it. At boot the app activates the query column
	// (app.ts) before the first fromHash; the resulting setActivePane would writeHash a still-empty `desired` and
	// delete the col= entries the reloaded URL carries, dropping every restored component-pane view. This flag, set
	// once fromHash has parsed the hash, gates writes until that read has happened.
	private hydrated = false;

	init(strip: ShuColumnStrip, hooks: PaneHooks = {}): void {
		this.strip = strip;
		this.hooks = hooks;
		window.addEventListener("hashchange", () => this.fromHash());
		// Per-pane control toggles (minimize / maximize / expand) update the canonical
		// `desired.flag` so later reconciles preserve it and the URL hash stays in sync.
		// Otherwise a later `request()` re-applies an undefined flag and wipes the
		// minimized / maximized state.
		strip.addEventListener(SHU_EVENT.COLUMN_MINIMIZE, ((e: CustomEvent) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset.columnKey;
			if (!id) return;
			const minimized = Boolean(e.detail?.minimized);
			this.setFlag(id, minimized ? "min" : undefined);
		}) as EventListener);
		strip.addEventListener(SHU_EVENT.COLUMN_MAXIMIZE, ((e: CustomEvent) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset.columnKey;
			if (!id) return;
			const maximized = Boolean(e.detail?.maximized);
			this.setFlag(id, maximized ? "max" : undefined);
		}) as EventListener);
		strip.addEventListener(SHU_EVENT.COLUMN_EXPAND, ((e: Event) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset.columnKey;
			if (!id) return;
			this.setFlag(id, undefined);
		}) as EventListener);
	}

	/** Update the flag for a pane already in `desired`. No-op when the pane is unknown
	 * (e.g. the query pane, which lives outside PaneState's tracked set). Writes the
	 * URL hash so the flag survives a reload. */
	private setFlag(paneId: string, flag: DesiredPane["flag"]): void {
		const d = this.desired.get(paneId);
		if (!d) return;
		if (d.flag === flag) return;
		this.desired.set(paneId, { ...d, flag } as DesiredPane);
		this.writeHash();
	}

	/** Parse the URL hash into desired panes and reconcile. */
	fromHash(): void {
		if (ViewHash.getHash() === this.lastWrittenHash) return; // its own echo, desired already matches; don't rebuild (would clobber an in-flight open)
		this.hydrated = true; // the hash has now been read at least once, writes are safe (see `hydrated`)
		// `open=` arrivals never reach here: view-hash canonicalizes them into col= entries at its ingress.
		const params = ViewHash.hashParams(ViewHash.getHash());
		const active = params.get("active");
		const next = new Map<string, DesiredPane>();
		const idParam = params.get("id");
		const labelParam = params.get("label");
		const rawCols = params.getAll("col");
		if (idParam && labelParam && rawCols.length === 0) {
			const d = parseColEntry(`e:${labelParam}:${idParam}`);
			if (d) next.set(paneIdOf(d), withPersistedFlag(d));
		}
		for (const raw of rawCols) {
			const d = parseColEntry(raw);
			if (d) next.set(paneIdOf(d), withPersistedFlag(d));
		}
		// Only name an active pane when the hash describes one. A hash with no col= entries describes no panes, and
		// writing its empty answer here unset the activation of a pane that is on screen but not in the hash: the boot
		// query column, leaving panes open with nothing active.
		const named = active && next.has(active) ? active : firstKeyOf(next);
		if (named) this.activePaneId = named;
		this.desired = next;
		this.scheduleReconcile();
	}

	/** Add or update a pane. Validates against the schema; throws loudly on a bad input. */
	request(input: DesiredPane): void {
		const parsed = DesiredPaneSchema.parse(input);
		const id = paneIdOf(parsed);
		const existing = this.desired.get(id);
		// A re-request without an explicit flag keeps the live pane's flag (a click on an already-open,
		// minimized column must not silently expand it); a brand-new pane defaults from its persisted state.
		const d = parsed.flag ? parsed : existing?.flag ? ({ ...parsed, flag: existing.flag } as DesiredPane) : withPersistedFlag(parsed);
		// Re-request with fresh component data: hand it to the live child directly.
		if (existing && d.paneType === "component" && d.data) {
			const live = this.findLiveChild(id);
			if (live) (live as HTMLElement & { products?: Record<string, unknown> }).products = d.data;
		}
		// Re-request of an open individual with a passage selector: the pane already shows the document, so hand the
		// selector to the live column to reveal, attach hooks only fire for new panes.
		if (existing && d.paneType === "entity" && d.selector) {
			const live = this.findLiveChild(id) as (HTMLElement & { revealPassage?: (s: TQuoteAnchor) => void }) | undefined;
			live?.revealPassage?.(d.selector);
		}
		this.desired.set(id, d);
		this.activePaneId = id;
		this.scheduleReconcile();
	}

	/** Record an externally-chosen active pane (e.g. a column-strip click or breadcrumb) so the MODEL agrees with the
	 * strip. Without this the model's activePaneId stays stale and the next reconcile re-asserts it, snapping the active
	 * column back off the one just clicked. Writes the hash in the paneId form `fromHash` reads, callers must NOT
	 * write a numeric `active` (which fromHash can't resolve, so it falls back to the leftmost pane). */
	setActivePane(paneId: string): void {
		if (this.activePaneId === paneId) return;
		this.activePaneId = paneId;
		if (!this.hydrated) return; // a boot activation fires before the first fromHash; writing now would strip the restored col= entries (see `hydrated`). fromHash sets the active pane from the hash.
		this.writeHash();
	}

	/** Miller-column open. `source` is the originating element or the in-flight event; the source pane is identified via element.closest or event.composedPath. When `addToSelection` is true the prune is skipped. Every view that opens a column MUST route through this method instead of calling `request` directly. */
	requestFrom(source: Element | Event, input: DesiredPane, addToSelection = false): void {
		if (!this.strip) {
			this.request(input);
			return;
		}
		const sourcePane = this.findSourcePane(source);
		const sourceIdx = sourcePane ? this.strip.panes.indexOf(sourcePane as ShuColumnPane) : -1;
		if (!addToSelection && sourceIdx >= 0) {
			const panes = this.strip.panes;
			for (let i = panes.length - 1; i > sourceIdx; i--) {
				const pane = panes[i];
				if (pane.hasAttribute(SHU_ATTR.PINNED)) continue;
				const paneId = pane.dataset.columnKey;
				if (paneId) this.dismiss(paneId);
			}
		}
		this.request(input);
	}

	private findSourcePane(source: Element | Event): HTMLElement | undefined {
		if (source instanceof Element) {
			return (source.closest("shu-column-pane") as HTMLElement | null) ?? undefined;
		}
		// Event path: try composedPath first (only populated mid-dispatch). Fall back to target ancestry, then currentTarget: each is valid in different bubbling phases.
		const path = typeof source.composedPath === "function" ? source.composedPath() : [];
		const fromPath = path.find((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "SHU-COLUMN-PANE");
		if (fromPath) return fromPath;
		const target = source.target;
		if (target instanceof Element) {
			const closest = target.closest("shu-column-pane") as HTMLElement | null;
			if (closest) return closest;
		}
		const cur = source.currentTarget;
		if (cur instanceof Element) {
			const closest = cur.closest("shu-column-pane") as HTMLElement | null;
			if (closest) return closest;
		}
		return undefined;
	}

	dismiss(paneId: string): void {
		if (!this.desired.delete(paneId)) return;
		if (this.activePaneId === paneId) this.activePaneId = firstKeyOf(this.desired);
		this.scheduleReconcile();
	}

	snapshot(): DesiredPane[] {
		return [...this.desired.values()];
	}

	has(paneId: string): boolean {
		return this.desired.has(paneId);
	}

	__resetForTests(): void {
		this.desired.clear();
		this.activePaneId = null;
		this.strip = null;
		this.hooks = {};
		this.reconcileInFlight = false;
		this.reconcileRequested = false;
		this.lastWrittenHash = null;
		this.hydrated = false;
	}

	private reconcileInFlight = false;
	private reconcileRequested = false;

	private scheduleReconcile(): void {
		this.reconcileRequested = true;
		if (this.reconcileInFlight) return;
		this.reconcileInFlight = true;
		queueMicrotask(async () => {
			while (this.reconcileRequested) {
				this.reconcileRequested = false;
				await this.reconcile();
			}
			this.reconcileInFlight = false;
		});
	}

	private async reconcile(): Promise<void> {
		if (!this.strip) return;
		const live = new Map<string, ShuColumnPane>();
		for (const p of this.strip.panes) {
			const id = p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE);
			if (id && id !== INDEX_PANE_KEY) live.set(id, p);
		}
		// Route removals through `removePane` so the strip emits COLUMNS_CHANGED for each
		// dismissal. A bare `pane.remove()` mutates the DOM but the actions-bar breadcrumb
		// (which listens on COLUMNS_CHANGED) would never update.
		for (const [id, pane] of live) {
			if (this.desired.has(id)) continue;
			const idx = this.strip.panes.indexOf(pane);
			if (idx >= 0) this.strip.removePane(idx);
			else pane.remove();
		}
		// The address IS the view state, so it is written from the desired set BEFORE the panes catch up to it. Opening
		// a pane awaits its component module and then its data; an address written only once that finished would lag
		// the view it names: a reader copying the address (or reloading) mid-open would miss the column.
		this.writeHash();
		// Iterate a SNAPSHOT, not the live `desired.values()` iterator: opening a pane awaits, and a request landing during
		// that await can `dismiss`+`request` the same key (a prune-then-reopen), which a live iterator would re-yield:
		// reopening a pane still being opened. The snapshot is this pass's target; the request scheduled its own reconcile.
		for (const d of [...this.desired.values()]) {
			const id = paneIdOf(d);
			const existing = live.get(id);
			if (existing) {
				existing.setAttribute("label", labelOf(d));
				existing.setMinimized(d.flag === "min");
				continue;
			}
			await this.openPane(d, id);
		}
		// A maximize describes the FINISHED set, not the moment one pane attaches: applied per arrival, the next pane of
		// the same restore counts as a column being opened and ends the maximize the restore just applied.
		this.applyMaximizeFlag();
		this.strip.updateAccordion(); // flag changes on existing panes shift the layout budget
		this.strip.applyActive(); // re-assert active styling now the panes match `desired` (the target pane may have just opened)
	}

	/** Exactly the pane the desired set flags `max` is maximized, once every pane the set names is attached. */
	private applyMaximizeFlag(): void {
		if (!this.strip) return;
		const maxId = [...this.desired.values()].find((d) => d.flag === "max");
		const wanted = maxId ? paneIdOf(maxId) : null;
		for (const pane of this.strip.panes) {
			const id = pane.dataset.columnKey ?? pane.getAttribute(SHU_ATTR.COLUMN_TYPE);
			pane.setMaximized(!!wanted && id === wanted);
		}
	}

	private async openPane(d: DesiredPane, id: string): Promise<void> {
		if (!this.strip) return;
		const tag = tagOf(d);
		await this.hooks.ensureLoaded?.(tag);
		// One pane per columnKey, always. The `ensureLoaded` await is a window in which another reconcile pass or a
		// re-request can already have opened this key; creating a second here would leave two panes the reconciler can
		// never tell apart (its live map collapses same-key panes) and `applyActive` would light both. Never duplicate.
		if (this.strip.panes.some((p) => p.dataset.columnKey === id)) return;
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", labelOf(d));
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, columnTypeFor(d));
		// Default unpinned: only explicitly pinned panes survive a Miller-column prune.
		// The columnKey is also the pane's persistence identity: its remembered width/minimize
		// restore when it attaches (ShuElement.persistFields), so no width plumbing here.
		pane.dataset.columnKey = id;
		// Pre-mark a minimized arrival so addPane neither activates nor scrolls to it.
		if (d.flag === "min") pane.setMinimized(true);
		this.strip.addPane(pane);
		const child = document.createElement(tag);
		if (readShowControlsCookie(tag)) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		if (d.paneType === "component" && d.data) (child as HTMLElement & { products?: Record<string, unknown> }).products = d.data;
		pane.appendChild(child);
		pane.setMinimized(d.flag === "min");
		// An afterAttach hook calls the child's own methods, which exist only once this element has been upgraded to its
		// definition. `ensureLoaded` starts the module; the definition it registers arrives on a later task, and an
		// element created before it is a plain element until upgraded, waiting for the definition alone still met one,
		// since the upgrade of an existing instance is a reaction that has not necessarily run when the wait resolves.
		await customElements.whenDefined(tag);
		customElements.upgrade(child);
		// The hook is about to call the child's own methods. If the upgrade did not take, it fails inside the hook as
		// "child.open is not a function", which names neither the pane nor the tag. Say it here, where both are known.
		const definition = customElements.get(tag);
		if (definition && !(child instanceof definition))
			throw new Error(`pane ${id}: <${tag}> is defined but this element did not upgrade to it, so the ${d.paneType} pane has none of its own methods`);
		await this.hooks.afterAttach?.[d.paneType]?.(d, child);
	}

	private writeHash(): void {
		// Never write before the first fromHash has READ the reloaded URL (see `hydrated`). A reconcile triggered by an
		// early request, e.g. a step's products re-opening a pane at boot, which can land before fromHash under load
		// would otherwise overwrite the reloaded hash with the partial desired set, dropping the col= views still waiting
		// to be restored. This generalises the setActivePane guard to every writer (the boot-strip regression).
		if (!this.hydrated) return;
		const base = ViewHash.getHash();
		const params = ViewHash.hashParams(base);
		params.delete("col");
		for (const d of this.desired.values()) {
			const suffix = d.flag === "min" ? "~min" : d.flag === "max" ? "~max" : "";
			params.append("col", `${paneIdOf(d)}${suffix}`);
		}
		if (this.activePaneId) params.set("active", this.activePaneId);
		else params.delete("active");
		const next = `#?${params.toString()}`;
		this.lastWrittenHash = next; // mark as this instance's so the echoed hashchange doesn't re-enter fromHash and clobber desired
		if (next !== base) ViewHash.pushHash(next);
	}

	private findLiveChild(paneId: string): HTMLElement | undefined {
		const pane = this.strip?.panes.find((p) => p.dataset.columnKey === paneId);
		return pane?.children[0] as HTMLElement | undefined;
	}
}

function firstKeyOf(m: Map<string, DesiredPane>): string | null {
	const it = m.keys().next();
	return it.done ? null : it.value;
}

function columnTypeFor(d: DesiredPane): string {
	if (d.paneType === "component") return d.tag;
	if (d.paneType === "filter-eq" || d.paneType === "filter-prop" || d.paneType === "filter-incoming") return "filter";
	if (d.paneType === "step-detail") return "step";
	return d.paneType;
}

/** A column the user last minimized reopens minimized: its pane persists `minimized` (ShuElement.persistFields),
 * and that remembered state becomes the default flag when the hash or caller doesn't specify one. Only `min` is
 * defaulted: re-applying a remembered maximize would unexpectedly hide the rest of the workspace. */
function withPersistedFlag(d: DesiredPane): DesiredPane {
	if (d.flag) return d;
	const saved = readElementPrefs("shu-column-pane", paneIdOf(d));
	return saved?.minimized === true ? ({ ...d, flag: "min" } as DesiredPane) : d;
}

/**
 * Parse one `col=` URL entry into a DesiredPane. Returns null for malformed
 * entries: `fromHash` skips nulls so a stale hash never crashes the boot.
 *
 * Each prefix maps to one paneType: `e:` entity, `type:` type, `f:` filter-eq, `p:` filter-prop,
 * `i:` filter-incoming, `t:` thread, `step:` step-detail. Anything else is a component tag.
 */
export function parseColEntry(raw: string): DesiredPane | null {
	const flag: DesiredPane["flag"] = raw.endsWith("~max") ? "max" : raw.endsWith("~min") ? "min" : undefined;
	const body = flag ? raw.slice(0, -4) : raw;
	const colon = (s: string) => {
		const i = s.indexOf(":");
		return i < 0 ? null : ([s.slice(0, i), s.slice(i + 1)] as const);
	};
	if (body.startsWith("e:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "entity", persistedAs: split[0], id: split[1], flag });
	}
	if (body.startsWith("f:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		const eq = split[1].indexOf("=");
		if (eq < 0) return null;
		return safe({ paneType: "filter-eq", persistedAs: split[0], predicate: split[1].slice(0, eq), value: split[1].slice(eq + 1), flag });
	}
	if (body.startsWith("p:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "filter-prop", persistedAs: split[0], predicate: split[1], flag });
	}
	if (body.startsWith("i:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "filter-incoming", persistedAs: split[0], subject: split[1], flag });
	}
	if (body.startsWith("type:")) return safe({ paneType: "type", persistedAs: body.slice(5), flag }); // before `t:`: a type ref has no second colon
	if (body.startsWith("t:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "thread", persistedAs: split[0], subject: split[1], flag });
	}
	if (body.startsWith("step:")) {
		const seq = body.slice(5).split(".").map(Number);
		if (seq.some((n) => Number.isNaN(n))) return null;
		return safe({ paneType: "step-detail", seqPath: seq, flag });
	}
	return safe({ paneType: "component", tag: body, label: body, flag });
}

function safe(input: unknown): DesiredPane | null {
	const r = DesiredPaneSchema.safeParse(input);
	return r.success ? r.data : null;
}

export const PaneState = new PaneStateImpl();
