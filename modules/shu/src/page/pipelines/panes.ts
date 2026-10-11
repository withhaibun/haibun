/**
 * The page's panes: a request, a dismissal, an activation and a pane's own control move the pane machine, and the pipeline
 * brings the strip and the address to the machine's state. The address is the panes' state, so the page writes it from the
 * machine before the strip's views load, and reads it at each arrival at an address the page didn't write.
 *
 *   the address  ──┐
 *   a step       ──┼──► the pane machine ──► the strip and the address
 *   a view       ──┘
 */
import type { Machine } from "@haibun/core/lib/machine.js";
import { INDEX_PANE_KEY } from "../../domains/elements.js";
import * as Address from "../derivations/address.js";
import * as Kinds from "../derivations/pane-kinds.js";
import { PANES_EVENT, type TPagePane, type TPanesEvent, type TPanesState } from "../machines/panes.js";
import type { TPaneControl, TPaneStrip, TSharedCell } from "../ports.js";

type DesiredPane = Kinds.DesiredPane;

/** What a pane kind's view is given once it attaches: the data its pane carries, as each kind's view takes it. */
export type TPaneAttach = { [K in Kinds.DesiredPaneType]?: (d: Extract<DesiredPane, { paneType: K }>, view: HTMLElement) => Promise<void> | void };

/** What opening a pane calls: the load of its view's module, and what its view is given once it attaches. */
export type TPaneHooks = { load(tag: string): Promise<void>; attach: TPaneAttach };

/** What the page holds of its panes beside the machine: the strip and the hooks it opens panes with, the last address it
 *  wrote, and whether a reconcile is under way or requested. */
export type TPanesHeld = { strip: TPaneStrip | undefined; hooks: TPaneHooks | undefined; lastWritten: string | undefined; reconciling: boolean; requested: boolean };

/** What the pane pipeline reads and writes. */
export type TPanesScope = {
	machine: Machine<TPanesState, TPanesEvent>;
	held: TPanesHeld;
	/** The page's address. */
	address: { get(): string; push(hash: string): void };
	/** The pane the reader acts from, which every view reads. */
	active: TSharedCell<string | null>;
	/** Whether the reader minimized the pane `id` when it was last shown. */
	minimizedBefore(id: string): boolean;
	/** Whether a view of `tag` shows its controls, as the reader last chose. */
	showsControls(tag: string): boolean;
	/** The attribute a view that shows its controls carries. */
	showControlsAttribute: string;
	kinds: Kinds.TPaneContext;
};

/** Returns the machine's state with the active pane every view reads. The strip and a breadcrumb set that pane, and the
 *  machine takes it before each move. */
function synced(scope: TPanesScope): TPanesState {
	const active = scope.active.get();
	return active === scope.machine.state.get().active ? scope.machine.state.get() : scope.machine.dispatch({ type: PANES_EVENT.ACTIVATE, id: active });
}

/** Moves the machine with `event`, and sets the active pane every view reads where the move changes it. */
function move(scope: TPanesScope, event: TPanesEvent): TPanesState {
	const before = synced(scope);
	const after = scope.machine.dispatch(event);
	if (after.active !== before.active) scope.active.set(after.active);
	return after;
}

/** Returns `d` minimized where it doesn't state a flag and the reader minimized it when it was last shown. Only a minimize
 *  returns: a maximize that returned would hide the panes a reader opens beside it. */
const withMinimized = (scope: TPanesScope, d: DesiredPane): DesiredPane =>
	d.flag === undefined && scope.minimizedBefore(Kinds.paneIdOf(d)) ? ({ ...d, flag: "min" } as DesiredPane) : d;

/** Opens the panes on `strip`, with the panes the page always holds. */
export function openStrip(scope: TPanesScope, strip: TPaneStrip, hooks: TPaneHooks, pagePanes: ReadonlyArray<TPagePane>): void {
	scope.held.strip = strip;
	scope.held.hooks = hooks;
	move(scope, { type: PANES_EVENT.DECLARE, pagePanes: new Map(pagePanes.map((page) => [Kinds.paneIdOf(page.pane), { ...page, pane: Kinds.DesiredPaneSchema.parse(page.pane) }])) });
}

/** Takes the change a pane's own control made: a dock moves the pane, and a flag is written into the address, which carries
 *  it to a reload. */
export function control(scope: TPanesScope, id: string, change: TPaneControl): void {
	if ("docked" in change) {
		move(scope, { type: PANES_EVENT.DOCK, id, docked: change.docked });
		scheduleReconcile(scope);
	} else if (synced(scope).desired.has(id)) {
		move(scope, { type: PANES_EVENT.FLAG, id, flag: change.flag });
		writeAddress(scope);
	}
}

/** Reads the address into the panes it names, at an arrival at an address the page didn't write. The page's own write already
 *  matches the machine, and a read of it during an open removes the pane being opened. */
export function restoreFromAddress(scope: TPanesScope): void {
	const hash = scope.address.get();
	if (hash === scope.held.lastWritten) return;
	const params = Address.hashParams(hash);
	const named = new Map<string, DesiredPane>();
	for (const raw of params.getAll(Address.COLUMN_PARAM)) {
		const d = Kinds.parseColEntry(raw, scope.kinds);
		if (d) named.set(Kinds.paneIdOf(d), withMinimized(scope, d));
	}
	// A page pane the address names stands where the address places it, and one it doesn't name stands as the page declares it.
	const pageStanding = new Map<string, DesiredPane>();
	for (const [id, page] of scope.machine.state.get().pagePanes) {
		const at = named.get(id);
		pageStanding.set(id, at ? ({ ...page.pane, flag: at.flag, docked: at.docked } as DesiredPane) : withMinimized(scope, page.pane));
	}
	const active = params.get(Address.ACTIVE_PARAM);
	move(scope, { type: PANES_EVENT.RESTORE, named, active: active === null ? undefined : active, pageStanding });
	scheduleReconcile(scope);
}

/** Shows a pane, and makes it the active pane. A request for an open pane gives its view what the request carries, since a
 *  view is given its pane's data once, when it attaches. */
export function request(scope: TPanesScope, input: DesiredPane): void {
	const pane = Kinds.DesiredPaneSchema.parse(input);
	const id = Kinds.paneIdOf(pane);
	const view = scope.machine.state.get().desired.has(id) || pane.paneType === "entity" ? scope.held.strip?.view(id) : undefined;
	if (view !== undefined) Kinds.updateView(pane, view);
	move(scope, { type: PANES_EVENT.REQUEST, id, pane, minimizedBefore: scope.minimizedBefore(id) });
	scheduleReconcile(scope);
}

/** Shows a pane from the pane `source` is in, as a column after it: the panes after the source close, apart from a pinned
 *  and a docked pane, unless `addToSelection`. Each view that opens a pane opens it here. */
export function requestFrom(scope: TPanesScope, source: Element | Event, input: DesiredPane, addToSelection: boolean): void {
	const after = addToSelection ? undefined : scope.held.strip?.after(source);
	// The panes close from the last, as a reader closes them.
	for (const id of [...(after === undefined ? [] : after)].reverse()) dismiss(scope, id);
	request(scope, input);
}

/** Makes `id` the active pane, as the strip or a reader chose it. */
export function activate(scope: TPanesScope, id: string): void {
	const before = synced(scope);
	if (move(scope, { type: PANES_EVENT.ACTIVATE, id }) !== before) writeAddress(scope);
}

/** Closes a pane. A page pane returns to where the page declares it, since the page holds it either way. */
export function dismiss(scope: TPanesScope, id: string): void {
	const state = synced(scope);
	if (!state.desired.has(id)) return;
	if (state.pagePanes.has(id)) scope.held.strip?.close(id);
	move(scope, { type: PANES_EVENT.DISMISS, id });
	scheduleReconcile(scope);
}

/** Brings the strip to the machine's state once the current pass ends, as many requests in a row ask for one pass. */
function scheduleReconcile(scope: TPanesScope): void {
	scope.held.requested = true;
	if (scope.held.reconciling) return;
	scope.held.reconciling = true;
	queueMicrotask(async () => {
		while (scope.held.requested) {
			scope.held.requested = false;
			await reconcile(scope);
		}
		scope.held.reconciling = false;
	});
}

/** Brings the strip to the machine's state: removes the panes the state doesn't name, writes the address, updates each open
 *  pane, opens each new one, and maximizes the pane the state flags once every pane the state names has attached. */
async function reconcile(scope: TPanesScope): Promise<void> {
	const strip = scope.held.strip;
	if (strip === undefined) return;
	const live = new Set(strip.ids().filter((id) => id !== INDEX_PANE_KEY));
	for (const id of live) if (!scope.machine.state.get().desired.has(id)) strip.remove(id);
	// The address is the view's state, so it is written before the panes' views load: a reader who copies the address during
	// an open has the pane it names.
	writeAddress(scope);
	let placementChanged = false;
	// The pass opens the panes the state names as it begins. A request during an open schedules its own pass.
	for (const d of [...scope.machine.state.get().desired.values()]) {
		const id = Kinds.paneIdOf(d);
		if (live.has(id)) {
			if (strip.update(id, Kinds.labelOf(d), d.flag === "min", Boolean(d.docked))) placementChanged = true;
			continue;
		}
		await openPane(scope, strip, d, id);
	}
	// A maximize describes the panes once each has attached: applied as one attaches, the next pane of a restore ends it.
	const max = [...scope.machine.state.get().desired.values()].find((d) => d.flag === "max");
	strip.settle(max === undefined ? null : Kinds.paneIdOf(max), placementChanged);
}

/** Opens the pane `d` under `id`: loads its view's module, makes the pane and its view, and gives the view its pane's data. */
async function openPane(scope: TPanesScope, strip: TPaneStrip, d: DesiredPane, id: string): Promise<void> {
	const hooks = scope.held.hooks;
	if (hooks === undefined) throw new Error(`the pane ${id} opens before the page opens its strip`);
	const viewTag = Kinds.tagOf(d, scope.kinds);
	await hooks.load(viewTag);
	const page = scope.machine.state.get().pagePanes.get(id);
	const viewAttributes = { ...(page === undefined ? {} : page.attributes), ...(scope.showsControls(viewTag) ? { [scope.showControlsAttribute]: "" } : {}) };
	const view = await strip.open({
		id,
		label: Kinds.labelOf(d),
		columnType: Kinds.columnTypeOf(d),
		// A pane the page always holds doesn't have a place to close to, so its dock control moves it.
		closable: page === undefined,
		docked: Boolean(d.docked),
		minimized: d.flag === "min",
		viewTag,
		viewAttributes,
		seed: (v) => Kinds.seedView(d, v),
	});
	if (view === undefined) return;
	const attach = hooks.attach[d.paneType] as ((pane: DesiredPane, v: HTMLElement) => Promise<void> | void) | undefined;
	await attach?.(d, view);
}

/** Writes the machine's panes and active pane into the address, once the page has read its address. A page pane the address
 *  names only where it stands other than as the page declares it. */
function writeAddress(scope: TPanesScope): void {
	const state = synced(scope);
	if (!state.read) return;
	const base = scope.address.get();
	const params = Address.hashParams(base);
	params.delete(Address.COLUMN_PARAM);
	for (const [id, d] of state.desired) {
		const page = state.pagePanes.get(id)?.pane;
		if (page && Boolean(page.docked) === Boolean(d.docked) && page.flag === d.flag) continue;
		params.append(Address.COLUMN_PARAM, `${id}${d.docked ? Address.PANE_ENDING.dock : ""}${d.flag ? Address.PANE_ENDING[d.flag] : ""}`);
	}
	if (state.active) params.set(Address.ACTIVE_PARAM, state.active);
	else params.delete(Address.ACTIVE_PARAM);
	const next = Address.hashOf(params);
	// The address this writes is the page's own, so its arrival doesn't restore the panes again.
	scope.held.lastWritten = next;
	if (next !== base) scope.address.push(next);
}
