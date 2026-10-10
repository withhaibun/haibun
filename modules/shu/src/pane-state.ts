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
 * via `paneIdOf` / `tagOf` / `labelOf`. It doesn't hold redundant fields, so the fields don't drift.
 */
import { PartSchema, type TPart } from "@haibun/core/lib/resources.js";
import { PART_DIRECTIVE, partDirectiveFor, splitPart } from "@haibun/core/lib/typed-links.js";
import { z } from "zod";
import * as ViewHash from "./view-hash.js";
import { objectId } from "./object-id.js";
import { INDEX_PANE_KEY, SHU_ATTR, SHU_EVENT, SHU_TAG } from "./domains/elements.js";
import { pagePreferences } from "./page/root.js";
import { INITIAL_SHOWN_CONTROLS, ShownControlsSchema, shownControlsKey } from "./page/domains/settings.js";
import { storedSetting } from "./page/derivations/settings.js";
import { presentationForType } from "./graph/type-presentation.js";
import { getUiByComponent } from "./rels-cache.js";
import { activePane } from "./signals.js";
import type { ShuColumnPane } from "./page/components/shu-column-pane.js";
import type { ShuColumnStrip } from "./page/components/shu-column-strip.js";
import { pagePinned } from "./page-pinned.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

const FlagSchema = z.enum(["min", "max"]).optional();
/** Where a pane stands and how: minimized or maximized, and docked along the bottom of the app rather than a column. */
const PLACEMENT = { flag: FlagSchema, docked: z.boolean().optional() };
const TagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const DesiredPaneSchema = z.discriminatedUnion("paneType", [
	z.object({ paneType: z.literal("component"), tag: TagSchema, label: z.string(), data: z.record(z.string(), z.unknown()).optional(), ...PLACEMENT }),
	z.object({
		paneType: z.literal("entity"),
		id: z.string(),
		persistedAs: z.string(),
		label: z.string().optional(),
		// A part of the individual to show: a quoted passage, or a fragment of its media. Not part of the pane's identity:
		// the pane is the individual, and a second reference into the same document reuses its column.
		selector: PartSchema.optional(),
		...PLACEMENT,
	}),
	z.object({ paneType: z.literal("type"), persistedAs: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-eq"), persistedAs: z.string(), predicate: z.string(), value: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-prop"), persistedAs: z.string(), predicate: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("filter-incoming"), persistedAs: z.string(), subject: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("thread"), persistedAs: z.string(), subject: z.string(), ...PLACEMENT }),
	z.object({ paneType: z.literal("step-detail"), seqPath: z.array(z.number()), ...PLACEMENT }),
	/** A step as actuality declares it, by its method. */
	z.object({ paneType: z.literal("step"), method: z.string().min(1), ...PLACEMENT }),
	/** An action a caller holds, by what it allows. */
	z.object({ paneType: z.literal("action"), action: z.string().min(1), ...PLACEMENT }),
	z.object({ paneType: z.literal("views-picker"), views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })), label: z.string(), ...PLACEMENT }),
]);

export type DesiredPane = z.infer<typeof DesiredPaneSchema>;
type DesiredPaneType = DesiredPane["paneType"];

/** What a view in the other bundle asks the page to open with `SHU_EVENT.PANE_OPEN`: its PaneState isn't the page's. */
export const PaneOpenSchema = z.object({ pane: DesiredPaneSchema, addToSelection: z.boolean() });
export type TPaneOpen = z.infer<typeof PaneOpenSchema>;

/** A click with a modifier adds the pane it opens beside the others, where a plain click replaces those to its right. */
export const addsToSelection = (e?: MouseEvent): boolean => Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey));

/** A pane of one kind. */
type TPaneOf<K extends DesiredPaneType> = Extract<DesiredPane, { paneType: K }>;
/** What a column entry states of a pane of one kind, without where the pane stands. */
type TParsed<K extends DesiredPaneType> = Omit<TPaneOf<K>, "paneType" | "flag" | "docked">;

/** How a kind of pane is addressed and shown: the prefix and address of its column entry, the component that shows it, its
 *  label, the column type its pane is marked with, and what an entry with its prefix states. Method signatures, so a kind's
 *  entry is read as an entry for any pane. */
type TPaneKind<K extends DesiredPaneType> = {
	prefix: string;
	address(d: TPaneOf<K>): string;
	tag(d: TPaneOf<K>): string;
	label(d: TPaneOf<K>): string;
	column(d: TPaneOf<K>): string;
	parse?(body: string): TParsed<K> | null;
};

/** `left:right` split at its first colon, or null where it doesn't have one. */
const atColon = (s: string): readonly [string, string] | null => {
	const i = s.indexOf(":");
	return i < 0 ? null : [s.slice(0, i), s.slice(i + 1)];
};
/** A type and the one value an entry names after it, as `Type:value`. */
const ofType =
	<F extends string>(field: F) =>
	(body: string) => {
		const split = atColon(body);
		return split ? ({ persistedAs: split[0], [field]: split[1] } as { persistedAs: string } & Record<F, string>) : null;
	};

/** Each kind of pane. A component's entry is its tag, which doesn't have a prefix, so an entry no prefix names is a component. */
const PANE_KINDS = {
	component: { prefix: "", address: (d) => d.tag, tag: (d) => d.tag, label: (d) => d.label, column: (d) => d.tag },
	entity: {
		prefix: "e:",
		address: (d) => objectId(d.persistedAs, d.id),
		// A type can declare its own column component (domain.ui.component); otherwise the generic entity column.
		tag: (d) => presentationForType(d.persistedAs).columnComponent() ?? SHU_TAG.ENTITY_COLUMN,
		label: (d) => d.label ?? d.id,
		column: () => "entity",
		parse: (body) => {
			const { base, anchor } = splitPart(body);
			const split = atColon(base);
			return split ? { persistedAs: split[0], id: split[1], ...(anchor ? { selector: anchor } : {}) } : null;
		},
	},
	type: {
		prefix: "type:",
		address: (d) => d.persistedAs,
		tag: () => SHU_TAG.TYPE_COLUMN,
		label: (d) => d.persistedAs,
		column: () => "type",
		parse: (body) => ({ persistedAs: body }),
	},
	"filter-eq": {
		prefix: "f:",
		address: (d) => `${d.persistedAs}:${d.predicate}=${d.value}`,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => `${d.predicate}=${d.value}`,
		column: () => "filter",
		parse: (body) => {
			const split = atColon(body);
			const eq = split ? split[1].indexOf("=") : -1;
			return split && eq >= 0 ? { persistedAs: split[0], predicate: split[1].slice(0, eq), value: split[1].slice(eq + 1) } : null;
		},
	},
	"filter-prop": {
		prefix: "p:",
		address: (d) => `${d.persistedAs}:${d.predicate}`,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => d.predicate,
		column: () => "filter",
		parse: ofType("predicate"),
	},
	"filter-incoming": {
		prefix: "i:",
		address: (d) => `${d.persistedAs}:${d.subject}`,
		tag: () => SHU_TAG.FILTER_COLUMN,
		label: (d) => `links to ${d.subject}`,
		column: () => "filter",
		parse: ofType("subject"),
	},
	thread: {
		prefix: "t:",
		address: (d) => `${d.persistedAs}:${d.subject}`,
		tag: () => SHU_TAG.THREAD_COLUMN,
		label: (d) => `Replies: ${d.subject}`,
		column: () => "thread",
		parse: ofType("subject"),
	},
	"step-detail": {
		prefix: "step:",
		address: (d) => d.seqPath.join("."),
		tag: () => SHU_TAG.STEP_DETAIL,
		label: (d) => `Step [${d.seqPath.join(".")}]`,
		column: () => "step",
		parse: (body) => {
			const seqPath = body.split(".").map(Number);
			return seqPath.some((n) => Number.isNaN(n)) ? null : { seqPath };
		},
	},
	step: { prefix: "def:", address: (d) => d.method, tag: () => SHU_TAG.STEP_DEFINITION, label: (d) => d.method, column: () => "step", parse: (method) => ({ method }) },
	action: { prefix: "act:", address: (d) => d.action, tag: () => SHU_TAG.ACTION_COLUMN, label: (d) => d.action, column: () => "action", parse: (action) => ({ action }) },
	"views-picker": { prefix: "", address: () => "views", tag: () => SHU_TAG.VIEWS_PICKER, label: (d) => d.label, column: () => "views-picker" },
} satisfies { [K in DesiredPaneType]: TPaneKind<K> };

/** A kind's entry read for any pane, which its method signatures allow. */
type TAnyPaneKind = {
	prefix: string;
	address(d: DesiredPane): string;
	tag(d: DesiredPane): string;
	label(d: DesiredPane): string;
	column(d: DesiredPane): string;
	parse?(body: string): object | null;
};

/** The entry of a pane's kind, as an entry for any pane. */
const kindOf = (d: DesiredPane): TAnyPaneKind => PANE_KINDS[d.paneType];

/** The id a pane is held and addressed by: its kind's prefix and its address. */
export const paneIdOf = (d: DesiredPane): string => `${kindOf(d).prefix}${kindOf(d).address(d)}`;

/** The column entry that addresses a pane: its id, and for an individual opened at a part, the part it shows. */
export function columnEntryOf(d: DesiredPane): string {
	return d.paneType === "entity" && d.selector ? `${paneIdOf(d)}${PART_DIRECTIVE}${partDirectiveFor(d.selector)}` : paneIdOf(d);
}

export const tagOf = (d: DesiredPane): string => kindOf(d).tag(d);
export const labelOf = (d: DesiredPane): string => kindOf(d).label(d);
const columnTypeFor = (d: DesiredPane): string => kindOf(d).column(d);

/**
 * Per-paneType post-attach hook. Each parametric pane (entity, filter, ...) needs
 * to call `.open(...)` on its freshly-created child. Keyed by `paneType` so a new
 * variant means one schema entry + one hook, without a central switch.
 *
 * `paneType: "component"` doesn't need a hook (data flows via `data`). External component
 * loading also lives here so pane-state doesn't have a direct registry dependency.
 */
type PaneHooks = { ensureLoaded?(tag: string): Promise<void> | void; afterAttach?: { [K in DesiredPaneType]?: (d: TPaneOf<K>, child: HTMLElement) => Promise<void> | void } };
/** The attach hook of a pane's kind, as a hook for any pane. */
type TAttach = (d: DesiredPane, child: HTMLElement) => Promise<void> | void;

/** A pane the page always holds, as declared, and the attributes its view is given. The address names it only where it
 *  stands other than as declared. It doesn't close, and a page that closes it returns it to where the page declares it. */
type TPagePane = { pane: DesiredPane; attributes?: Record<string, string> };

/** What the page holds of its panes. */
type TPanesHeld = {
	desired: Map<string, DesiredPane>;
	strip: ShuColumnStrip | null;
	hooks: PaneHooks;
	/** The panes the page always holds, by pane id. */
	pagePanes: Map<string, TPagePane>;
	/** The last hash this pushed. The resulting `hashchange` echoes back into fromHash, which rebuilds `desired` from the
	 *  hash: but a self-write's hash already matches `desired`, and re-reading it mid-mutation (e.g. an activation that
	 *  fires while a column is opening) clobbers the in-flight pane. So fromHash ignores its own writes and reacts only
	 *  to EXTERNAL hash changes (back/forward, a shared link). */
	lastWrittenHash: string | null;
	/** PaneState must READ the hash (fromHash) before it WRITES it. At boot the app activates the query column (app.ts)
	 *  before the first fromHash; the resulting setActivePane would writeHash a still-empty `desired` and delete the col=
	 *  entries the reloaded URL carries, dropping every restored component-pane view. This flag, set once fromHash has
	 *  parsed the hash, gates writes until that read has happened. */
	hydrated: boolean;
	reconcileInFlight: boolean;
	reconcileRequested: boolean;
};
const PANES_KEY = "__SHU_PANES__";

class PaneStateImpl {
	private get held(): TPanesHeld {
		return pagePinned(
			PANES_KEY,
			(): TPanesHeld => ({
				desired: new Map(),
				strip: null,
				hooks: {},
				pagePanes: new Map(),
				lastWrittenHash: null,
				hydrated: false,
				reconcileInFlight: false,
				reconcileRequested: false,
			}),
		);
	}
	// The active pane is the global `activePane` signal: the one source of truth every reader (strip styling, harvest,
	// isActiveView, dimming) derives from. PaneState is its writer on restore/open/dismiss; the strip subscribes and
	// paints the DOM `active` state, so activation is never a side effect of appending a pane.
	private get activePaneId(): string | null {
		return activePane.get();
	}
	private set activePaneId(id: string | null) {
		activePane.set(id);
	}

	init(strip: ShuColumnStrip, hooks: PaneHooks = {}, pagePanes: TPagePane[] = []): void {
		this.held.strip = strip;
		this.held.hooks = hooks;
		this.held.pagePanes = new Map(pagePanes.map((page) => [paneIdOf(page.pane), { ...page, pane: DesiredPaneSchema.parse(page.pane) }]));
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
		strip.addEventListener(SHU_EVENT.COLUMN_DOCK, ((e: CustomEvent) => {
			const id = (e.target as HTMLElement).dataset.columnKey;
			if (id) this.setDocked(id, Boolean(e.detail?.docked));
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
		const d = this.held.desired.get(paneId);
		if (!d) return;
		if (d.flag === flag) return;
		this.held.desired.set(paneId, { ...d, flag } as DesiredPane);
		this.writeHash();
	}

	/** Dock a pane along the bottom of the app, or return it to the strip. One pane is docked at a time, so docking a pane
	 *  returns the pane docked before it to the strip. */
	private setDocked(paneId: string, docked: boolean): void {
		if (!this.held.desired.has(paneId)) return;
		for (const [id, d] of this.held.desired) {
			const wanted = id === paneId ? docked : docked ? false : Boolean(d.docked);
			if (Boolean(d.docked) !== wanted) this.held.desired.set(id, { ...d, docked: wanted || undefined } as DesiredPane);
		}
		this.scheduleReconcile();
	}

	/** Parse the URL hash into desired panes and reconcile. */
	fromHash(): void {
		if (ViewHash.getHash() === this.held.lastWrittenHash) return; // its own echo, desired already matches; don't rebuild (would clobber an in-flight open)
		this.held.hydrated = true; // the hash has now been read at least once, writes are safe (see `hydrated`)
		// `open=` arrivals never reach here: view-hash canonicalizes them into col= entries at its ingress.
		const params = ViewHash.hashParams(ViewHash.getHash());
		const active = params.get(ViewHash.ACTIVE_PARAM);
		const next = new Map<string, DesiredPane>();
		const idParam = params.get("id");
		const labelParam = params.get("label");
		const rawCols = params.getAll(ViewHash.COLUMN_PARAM);
		if (idParam && labelParam && rawCols.length === 0) {
			const d = parseColEntry(`e:${labelParam}:${idParam}`);
			if (d) next.set(paneIdOf(d), withPersistedFlag(d));
		}
		for (const raw of rawCols) {
			const d = parseColEntry(raw);
			if (d) next.set(paneIdOf(d), withPersistedFlag(d));
		}
		// Only name an active pane when the hash describes one. A hash without col= entries doesn't describe a pane, and
		// writing its empty answer here unset the activation of a pane that is on screen but not in the hash: the boot
		// query column, leaving panes open without an active one.
		const named = active && next.has(active) ? active : firstKeyOf(next);
		if (named) this.activePaneId = named;
		// A page pane the address doesn't name stands as the page declares it. A page pane the address names stands where
		// the address places it. Both are added after the active pane is chosen, since a page pane doesn't take activation.
		for (const [id, page] of this.held.pagePanes) {
			const named = next.get(id);
			next.set(id, named ? ({ ...page.pane, flag: named.flag, docked: named.docked } as DesiredPane) : withPersistedFlag(page.pane));
		}
		this.held.desired = next;
		this.scheduleReconcile();
	}

	/** Add or update a pane. Validates against the schema; throws loudly on a bad input. */
	request(input: DesiredPane): void {
		const parsed = DesiredPaneSchema.parse(input);
		const id = paneIdOf(parsed);
		const existing = this.held.desired.get(id);
		// A re-request without an explicit flag keeps the live pane's flag (a click on an already-open,
		// minimized column must not silently expand it); a brand-new pane defaults from its persisted state.
		const flagged = parsed.flag ? parsed : existing?.flag ? ({ ...parsed, flag: existing.flag } as DesiredPane) : withPersistedFlag(parsed);
		// A re-request doesn't state where the pane stands, so a docked pane stays docked.
		const d = parsed.docked === undefined && existing?.docked ? ({ ...flagged, docked: true } as DesiredPane) : flagged;
		// Re-request with fresh component data: hand it to the live child directly.
		if (existing && d.paneType === "component" && d.data) {
			const live = this.findLiveChild(id);
			if (live) (live as HTMLElement & { products?: Record<string, unknown> }).products = d.data;
		}
		// A request for an individual with a part, whose column is live: the column already shows the document, so it is handed
		// the part to show, since attach hooks only fire for new panes. A request that follows a link prunes the panes after
		// the one it was followed from, which may be this one, and its column stays live under the same key.
		if (d.paneType === "entity" && d.selector) {
			const live = this.findLiveChild(id) as (HTMLElement & { revealPart?: (s: TPart) => void }) | undefined;
			live?.revealPart?.(d.selector);
		}
		this.held.desired.set(id, d);
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
		if (!this.held.hydrated) return; // a boot activation fires before the first fromHash; writing now would strip the restored col= entries (see `hydrated`). fromHash sets the active pane from the hash.
		this.writeHash();
	}

	/** Miller-column open. `source` is the originating element or the in-flight event; the source pane is identified via element.closest or event.composedPath. When `addToSelection` is true the prune is skipped. Every view that opens a column MUST route through this method instead of calling `request` directly. */
	requestFrom(source: Element | Event, input: DesiredPane, addToSelection = false): void {
		if (!this.held.strip) {
			this.request(input);
			return;
		}
		const sourcePane = this.findSourcePane(source);
		const sourceIdx = sourcePane ? this.held.strip.panes.indexOf(sourcePane as ShuColumnPane) : -1;
		if (!addToSelection && sourceIdx >= 0) {
			const panes = this.held.strip.panes;
			for (let i = panes.length - 1; i > sourceIdx; i--) {
				const pane = itemAt(panes, i);
				// A prune leaves a pinned pane and a docked pane, which isn't in the column order. A page pane it closes returns
				// to its place.
				if (pane.hasAttribute(SHU_ATTR.PINNED) || pane.docked) continue;
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

	/** Close a pane. A page pane returns to where the page declares it, since the page holds it either way. */
	dismiss(paneId: string): void {
		const page = this.held.pagePanes.get(paneId);
		if (page) return this.returnToPage(paneId, page.pane);
		if (!this.held.desired.delete(paneId)) return;
		if (this.activePaneId === paneId) this.activePaneId = firstKeyOf(new Map([...this.held.desired].filter(([id]) => !this.held.pagePanes.has(id))));
		this.scheduleReconcile();
	}

	/** Return a page pane to where the page declares it, unpinned, as a closed column forgets its pin. Where it docks, it
	 *  closes to its strip, and the pane docked there before it returns to the strip. */
	private returnToPage(paneId: string, declared: DesiredPane): void {
		if (!this.held.desired.has(paneId)) return;
		const live = this.held.strip?.panes.find((pane) => pane.dataset.columnKey === paneId);
		live?.setPinned(false);
		live?.close();
		this.held.desired.set(paneId, declared);
		if (declared.docked) this.setDocked(paneId, true);
		else this.scheduleReconcile();
	}

	snapshot(): DesiredPane[] {
		return [...this.held.desired.values()];
	}

	has(paneId: string): boolean {
		return this.held.desired.has(paneId);
	}

	private scheduleReconcile(): void {
		this.held.reconcileRequested = true;
		if (this.held.reconcileInFlight) return;
		this.held.reconcileInFlight = true;
		queueMicrotask(async () => {
			while (this.held.reconcileRequested) {
				this.held.reconcileRequested = false;
				await this.reconcile();
			}
			this.held.reconcileInFlight = false;
		});
	}

	private async reconcile(): Promise<void> {
		if (!this.held.strip) return;
		const live = new Map<string, ShuColumnPane>();
		for (const p of this.held.strip.panes) {
			const id = p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE);
			if (id && id !== INDEX_PANE_KEY) live.set(id, p);
		}
		// Route removals through `removePane` so the strip publishes its panes for each dismissal. A bare `pane.remove()`
		// mutates the DOM, and a reader of `stripPanes`, the actions bar's breadcrumb among them, doesn't see it.
		for (const [id, pane] of live) {
			if (this.held.desired.has(id)) continue;
			const idx = this.held.strip.panes.indexOf(pane);
			if (idx >= 0) this.held.strip.removePane(idx);
			else pane.remove();
		}
		// The address IS the view state, so it is written from the desired set BEFORE the panes catch up to it. Opening
		// a pane awaits its component module and then its data; an address written only once that finished would lag
		// the view it names: a reader copying the address (or reloading) mid-open would miss the column.
		this.writeHash();
		// Iterate a SNAPSHOT, not the live `desired.values()` iterator: opening a pane awaits, and a request landing during
		// that await can `dismiss`+`request` the same key (a prune-then-reopen), which a live iterator would re-yield:
		// reopening a pane still being opened. The snapshot is this pass's target; the request scheduled its own reconcile.
		let placementChanged = false;
		for (const d of [...this.held.desired.values()]) {
			const id = paneIdOf(d);
			const existing = live.get(id);
			if (existing) {
				existing.setAttribute("label", labelOf(d));
				existing.setMinimized(d.flag === "min");
				if (existing.docked !== Boolean(d.docked)) {
					existing.setDocked(Boolean(d.docked));
					placementChanged = true;
				}
				continue;
			}
			await this.openPane(d, id);
		}
		// A pane docked or returned changes which panes share the strip's width.
		if (placementChanged) this.held.strip.layoutColumns();
		// A maximize describes the FINISHED set, not the moment one pane attaches: applied per arrival, the next pane of
		// the same restore counts as a column being opened and ends the maximize the restore just applied.
		this.applyMaximizeFlag();
		this.held.strip.updateAccordion(); // flag changes on existing panes shift the layout limit
		this.held.strip.applyActive(); // re-assert active styling now the panes match `desired` (the target pane may have just opened)
	}

	/** Exactly the pane the desired set flags `max` is maximized, once every pane the set names is attached. */
	private applyMaximizeFlag(): void {
		if (!this.held.strip) return;
		const maxId = [...this.held.desired.values()].find((d) => d.flag === "max");
		const wanted = maxId ? paneIdOf(maxId) : null;
		for (const pane of this.held.strip.panes) {
			const id = pane.dataset.columnKey ?? pane.getAttribute(SHU_ATTR.COLUMN_TYPE);
			pane.setMaximized(!!wanted && id === wanted);
		}
	}

	private async openPane(d: DesiredPane, id: string): Promise<void> {
		if (!this.held.strip) return;
		const tag = tagOf(d);
		await this.held.hooks.ensureLoaded?.(tag);
		// One pane per columnKey, always. The `ensureLoaded` await is a window in which another reconcile pass or a
		// re-request can already have opened this key; creating a second here would leave two panes the reconciler can
		// never tell apart (its live map collapses same-key panes) and `applyActive` would light both. Never duplicate.
		if (this.held.strip.panes.some((p) => p.dataset.columnKey === id)) return;
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", labelOf(d));
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, columnTypeFor(d));
		// Default unpinned: only explicitly pinned panes survive a Miller-column prune.
		// The columnKey is also the pane's persistence identity: its remembered width/minimize
		// restore when it attaches (ShuElement.persistFields), so this doesn't handle widths.
		pane.dataset.columnKey = id;
		const page = this.held.pagePanes.get(id);
		// A pane the page always holds doesn't offer a close, since it doesn't have a place to close to. Its dock control moves it.
		if (page) pane.setAttribute(SHU_ATTR.CLOSABLE, "false");
		// Docked before it attaches, so the strip never lays it out as a column.
		if (d.docked) pane.setDocked(true);
		// Pre-mark a minimized arrival so addPane doesn't activate it or scroll to it.
		if (d.flag === "min") pane.setMinimized(true);
		this.held.strip.addPane(pane);
		const child = document.createElement(tag);
		for (const [name, value] of Object.entries(page?.attributes ?? {})) child.setAttribute(name, value);
		if (storedSetting(ShownControlsSchema, pagePreferences().read(SHU_TAG.COLUMN_PANE, shownControlsKey(tag)), INITIAL_SHOWN_CONTROLS).shown) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
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
		// "child.open is not a function", which doesn't name the pane or the tag. State it here, where both are known.
		const definition = customElements.get(tag);
		if (definition && !(child instanceof definition))
			throw new Error(`pane ${id}: <${tag}> is defined but this element did not upgrade to it, so the ${d.paneType} pane doesn't have its own methods`);
		await (this.held.hooks.afterAttach?.[d.paneType] as TAttach | undefined)?.(d, child);
	}

	private writeHash(): void {
		// Never write before the first fromHash has READ the reloaded URL (see `hydrated`). A reconcile triggered by an
		// early request, e.g. a step's products re-opening a pane at boot, which can land before fromHash under load
		// would otherwise overwrite the reloaded hash with the partial desired set, dropping the col= views still waiting
		// to be restored. This generalises the setActivePane guard to every writer (the boot-strip regression).
		if (!this.held.hydrated) return;
		const base = ViewHash.getHash();
		const params = ViewHash.hashParams(base);
		params.delete(ViewHash.COLUMN_PARAM);
		for (const d of this.held.desired.values()) {
			const id = paneIdOf(d);
			const page = this.held.pagePanes.get(id)?.pane;
			if (page && Boolean(page.docked) === Boolean(d.docked) && page.flag === d.flag) continue;
			const suffix = `${d.docked ? ViewHash.PANE_ENDING.dock : ""}${d.flag ? ViewHash.PANE_ENDING[d.flag] : ""}`;
			params.append(ViewHash.COLUMN_PARAM, `${id}${suffix}`);
		}
		if (this.activePaneId) params.set(ViewHash.ACTIVE_PARAM, this.activePaneId);
		else params.delete(ViewHash.ACTIVE_PARAM);
		const next = ViewHash.hashOf(params);
		this.held.lastWrittenHash = next; // mark as this instance's so the echoed hashchange doesn't re-enter fromHash and clobber desired
		if (next !== base) ViewHash.pushHash(next);
	}

	private findLiveChild(paneId: string): HTMLElement | undefined {
		const pane = this.held.strip?.panes.find((p) => p.dataset.columnKey === paneId);
		return pane?.children[0] as HTMLElement | undefined;
	}
}

function firstKeyOf(m: Map<string, DesiredPane>): string | null {
	const it = m.keys().next();
	return it.done ? null : it.value;
}

/** A column the user last minimized reopens minimized: its pane persists `minimized` (ShuElement.persistFields),
 * and that remembered state becomes the default flag when the hash or caller doesn't specify one. Only `min` is
 * defaulted: re-applying a remembered maximize would unexpectedly hide the rest of the workspace. */
function withPersistedFlag(d: DesiredPane): DesiredPane {
	if (d.flag) return d;
	const saved = pagePreferences().read(SHU_TAG.COLUMN_PANE, paneIdOf(d));
	return saved?.minimized === true ? ({ ...d, flag: "min" } as DesiredPane) : d;
}

/**
 * Parse one `col=` URL entry into a DesiredPane. Returns null for malformed
 * entries: `fromHash` skips nulls so a stale hash never crashes the boot.
 *
 * The prefix names the kind (`PANE_KINDS`), and an entry without a kind's prefix is a component tag. An entry ends in any
 * of the `PANE_ENDING`s of view-hash, which state where the pane stands.
 */
export function parseColEntry(raw: string): DesiredPane | null {
	const { id: body, endings } = ViewHash.splitPaneEntry(raw);
	const placement = { flag: endings.has("max") ? ("max" as const) : endings.has("min") ? ("min" as const) : undefined, docked: endings.has("dock") || undefined };
	for (const [paneType, kind] of Object.entries(PANE_KINDS) as [DesiredPaneType, TAnyPaneKind][]) {
		if (!kind.prefix || !kind.parse || !body.startsWith(kind.prefix)) continue;
		const parsed = kind.parse(body.slice(kind.prefix.length));
		return parsed ? safe({ paneType, ...parsed, ...placement }) : null;
	}
	return safe({ paneType: "component", tag: body, label: componentTitle(body), ...placement });
}

/** A component pane's title: the summary its domain's `ui` declares, as a step that opens it titles it, or its tag where the
 *  declaration doesn't state one. */
function componentTitle(tag: string): string {
	const summary = getUiByComponent(tag)?.summary;
	return typeof summary === "string" ? summary : tag;
}

function safe(input: unknown): DesiredPane | null {
	const r = DesiredPaneSchema.safeParse(input);
	return r.success ? r.data : null;
}

export const PaneState = new PaneStateImpl();
