/**
 * The page's view query, as views read and set it: the signals of the store the page holds, the hash a change writes, and
 * the access level the address states.
 */
import { AccessQuery } from "@haibun/core/lib/domains/resources.js";
import { ViewQuerySchema, QUERY_PARAMS, type TAccessQueryLevel, type TTypeNotHeld, type TViewQuery } from "../domains/view-query.js";
import { parseViewQuery, queryParams } from "../derivations/view-query.js";
import * as Address from "../derivations/address.js";
import { Signal } from "@lit-labs/signals";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { pageHeld } from "../root.js";
import * as PageHash from "./hash-controller.js";

const VIEW_QUERY_KEY = "__SHU_VIEW_QUERY__";

/** The view query's signals: one for each query param, and the hash the page last wrote, which a hashchange listener reads to
 *  skip the echo of its own write. */
type TViewQueryStore = {
	label: Signal.State<string | null>;
	q: Signal.State<string | null>;
	sort: Signal.State<string | null>;
	order: Signal.State<"asc" | "desc">;
	offset: Signal.State<number>;
	access: Signal.State<TAccessQueryLevel>;
	f: Signal.State<TSearchCondition[]>;
	lastWrittenHash: string;
};

/** Returns the view query's signals, which the page holds once, so every importer on the page reads one instance. */
const store = (): TViewQueryStore =>
	pageHeld(VIEW_QUERY_KEY, () => {
		const d = ViewQuerySchema.parse({});
		return {
			label: new Signal.State(d.label),
			q: new Signal.State(d.q),
			sort: new Signal.State(d.sort),
			order: new Signal.State(d.order),
			offset: new Signal.State(d.offset),
			access: new Signal.State<TAccessQueryLevel>(d.access),
			f: new Signal.State(d.f),
			lastWrittenHash: "",
		};
	});

/** Returns what a page shows for an address that names `label`, where actuality holds the types `held`. */
export function typeNotHeld(label: string, held: readonly string[]): TTypeNotHeld {
	return {
		error: `The address names the type ${label}, and actuality doesn't hold that type.`,
		held: held.map((type) => ({ label: type, href: viewQuery.hashWith({ label: type, sort: null, offset: 0 }) })),
	};
}

function snapshot(): TViewQuery {
	const s = store();
	return { label: s.label.get(), q: s.q.get(), sort: s.sort.get(), order: s.order.get(), offset: s.offset.get(), access: s.access.get(), f: s.f.get() };
}

function assign(q: TViewQuery): void {
	const s = store();
	s.label.set(q.label);
	s.q.set(q.q);
	s.sort.set(q.sort);
	s.order.set(q.order);
	s.offset.set(q.offset);
	s.access.set(q.access);
	s.f.set(q.f);
}

/** Returns the current hash with its query params replaced by `next`'s. The pane and affordance params stay. */
function mergedHash(next: TViewQuery): string {
	const merged = Address.hashParams(PageHash.getHash());
	for (const k of QUERY_PARAMS) merged.delete(k);
	for (const [k, v] of queryParams(next)) merged.append(k, v);
	return merged.toString() ? Address.hashOf(merged) : "";
}

export const viewQuery = {
	/** The signal set, read `viewQuery.signals.q.get()` inside a render() to subscribe reactively. */
	get signals(): TViewQueryStore {
		return store();
	},

	/** Non-reactive snapshot of the current query (for dispatch/serialize/compare). */
	get current(): TViewQuery {
		return snapshot();
	},

	/** True when `hash` is the one last written, lets a hashchange listener skip a self-write echo. */
	wroteHash(hash: string): boolean {
		return store().lastWrittenHash === hash;
	},

	/** Read the URL hash into the store (boot + back/forward). Fail-fast on a malformed param.
	 * `open=` arrivals never reach here: view-hash canonicalizes them into col= entries at its ingress. */
	hydrate(hash: string = PageHash.getHash()): void {
		assign(parseViewQuery(hash));
		store().lastWrittenHash = hash;
	},

	/** Validate + apply a partial change and write the merged hash back, preserving pane/affordance params. */
	set(patch: Partial<TViewQuery>): void {
		const next = ViewQuerySchema.parse({ ...snapshot(), ...patch });
		assign(next);
		const hash = mergedHash(next);
		store().lastWrittenHash = hash;
		PageHash.pushHash(hash);
	},

	/** Returns the hash a partial change states, with the pane and affordance params kept, without applying it. */
	hashWith(patch: Partial<TViewQuery>): string {
		return mergedHash(ViewQuerySchema.parse({ ...snapshot(), ...patch }));
	},
};

/** Returns the page's access level, as its address states it, which each read and write of a record carries. A view's change
 *  of the level writes the address, so the level and the view query read one value. A page without a window, a test under
 *  Node, reads at every level. */
export function appAccessLevel(): TAccessQueryLevel {
	return typeof window === "undefined" ? AccessQuery.all : parseViewQuery(window.location.hash).access;
}
