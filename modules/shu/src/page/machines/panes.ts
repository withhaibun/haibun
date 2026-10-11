/**
 * The page's panes as a machine: the panes the page shows, by id, the pane the reader acts from, the panes the page always
 * holds, and whether the page has read its address, since the page writes its address only after it reads it.
 */
import type { DesiredPane, TPaneFlag } from "../derivations/pane-kinds.js";

/** A pane the page always holds, as it declares it, and the attributes its view is given. The address names it only where it
 *  stands other than as declared. It doesn't close: a page that closes it returns it to where the page declares it. */
export type TPagePane = { pane: DesiredPane; attributes: Readonly<Record<string, string>> };

export type TPanesState = {
	desired: ReadonlyMap<string, DesiredPane>;
	active: string | null;
	pagePanes: ReadonlyMap<string, TPagePane>;
	/** Whether the page has read its address. A boot activation and an early request precede the first read, and a write
	 *  before it would remove the columns the reloaded address names. */
	read: boolean;
};

export const INITIAL_PANES: TPanesState = { desired: new Map(), active: null, pagePanes: new Map(), read: false };

export const PANES_EVENT = { DECLARE: "declare", RESTORE: "restore", REQUEST: "request", ACTIVATE: "activate", DISMISS: "dismiss", FLAG: "flag", DOCK: "dock" } as const;

export type TPanesEvent =
	/** The panes the page always holds, by id. */
	| { type: typeof PANES_EVENT.DECLARE; pagePanes: ReadonlyMap<string, TPagePane> }
	/** The panes the address names, by id, the pane it names active, and where each page pane stands. */
	| { type: typeof PANES_EVENT.RESTORE; named: ReadonlyMap<string, DesiredPane>; active: string | undefined; pageStanding: ReadonlyMap<string, DesiredPane> }
	/** A pane to show, under its id, and whether the reader minimized it when it was last shown. */
	| { type: typeof PANES_EVENT.REQUEST; id: string; pane: DesiredPane; minimizedBefore: boolean }
	/** The pane the reader acts from, or null, as the page's strip or a reader chose it. */
	| { type: typeof PANES_EVENT.ACTIVATE; id: string | null }
	| { type: typeof PANES_EVENT.DISMISS; id: string }
	| { type: typeof PANES_EVENT.FLAG; id: string; flag: TPaneFlag }
	| { type: typeof PANES_EVENT.DOCK; id: string; docked: boolean };

/** Returns the first id of `ids`, or null for an empty list. */
const firstOf = (ids: Iterable<string>): string | null => {
	for (const id of ids) return id;
	return null;
};

/** Returns `desired` with the pane `id` docked or returned to the strip. One pane docks at a time, so docking a pane returns
 *  the pane docked before it to the strip. */
function docked(desired: ReadonlyMap<string, DesiredPane>, id: string, dock: boolean): ReadonlyMap<string, DesiredPane> {
	const next = new Map(desired);
	for (const [paneId, d] of desired) {
		const wanted = paneId === id ? dock : dock ? false : Boolean(d.docked);
		if (Boolean(d.docked) !== wanted) next.set(paneId, { ...d, docked: wanted || undefined } as DesiredPane);
	}
	return next;
}

export function panesTransition(state: TPanesState, event: TPanesEvent): TPanesState {
	switch (event.type) {
		case PANES_EVENT.DECLARE:
			return { ...state, pagePanes: event.pagePanes };
		case PANES_EVENT.RESTORE: {
			// A page pane doesn't take the activation, so the active pane is chosen from the panes the address names. An address
			// that doesn't name a pane leaves the active pane as it is.
			const named = event.active !== undefined && event.named.has(event.active) ? event.active : firstOf(event.named.keys());
			return { ...state, desired: new Map([...event.named, ...event.pageStanding]), active: named === null ? state.active : named, read: true };
		}
		case PANES_EVENT.REQUEST: {
			const existing = state.desired.get(event.id);
			// A request that doesn't state a flag keeps the open pane's flag, so a click on a minimized pane doesn't expand it,
			// and a new pane opens minimized where the reader minimized it when it was last shown.
			const flag = event.pane.flag ?? existing?.flag ?? (event.minimizedBefore ? "min" : undefined);
			// A request doesn't state where the pane stands, so a docked pane stays docked.
			const dock = event.pane.docked === undefined && existing?.docked ? true : event.pane.docked;
			return { ...state, desired: new Map(state.desired).set(event.id, { ...event.pane, flag, docked: dock } as DesiredPane), active: event.id };
		}
		case PANES_EVENT.ACTIVATE:
			return state.active === event.id ? state : { ...state, active: event.id };
		case PANES_EVENT.DISMISS: {
			const page = state.pagePanes.get(event.id);
			if (page !== undefined) {
				if (!state.desired.has(event.id)) return state;
				const returned = new Map(state.desired).set(event.id, page.pane);
				return { ...state, desired: page.pane.docked ? docked(returned, event.id, true) : returned };
			}
			if (!state.desired.has(event.id)) return state;
			const desired = new Map(state.desired);
			desired.delete(event.id);
			const active = state.active === event.id ? firstOf([...desired.keys()].filter((id) => !state.pagePanes.has(id))) : state.active;
			return { ...state, desired, active };
		}
		case PANES_EVENT.FLAG: {
			const d = state.desired.get(event.id);
			return d === undefined || d.flag === event.flag ? state : { ...state, desired: new Map(state.desired).set(event.id, { ...d, flag: event.flag } as DesiredPane) };
		}
		case PANES_EVENT.DOCK:
			return state.desired.has(event.id) ? { ...state, desired: docked(state.desired, event.id, event.docked) } : state;
	}
}
