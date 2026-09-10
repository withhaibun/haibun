/**
 * viewQuery: the single, schema-validated source of truth for the URL-hash view/query state: the
 * type, text search, sort, pagination, access level, and compound filters that shu-graph-query and
 * the actions bar share. One signal per param, globalThis-pinned (so every importer in this realm
 * shares one instance); reading `.get()` inside a lit render() auto-subscribes the view via the
 * SignalWatcher base. The URL hash is the durable store: `hydrate()` reads it at boot and on
 * back/forward, `set()` writes it back, so a reload restores the view.
 *
 * FAIL-FAST: every param is validated by {@link ViewQuerySchema}. A malformed enum / non-integer
 * offset / bad filter operator throws rather than silently resetting (no `|| default`, no
 * `parseInt || 0`). The schema is the contract.
 *
 * SCOPE: this owns the QUERY params (label, q, sort, order, offset, access, f). The pane params
 * (col, active) and affordance deep-links (aff-goal, aff-waypoint) are still owned by PaneState and
 * the affordances panel; `set()` merges its params over the live hash so those survive untouched,
 * letting them be migrated into this store incrementally.
 */
import { Signal } from "@lit-labs/signals";
import { z } from "zod";
import { AccessQuery, AccessQueryLevelSchema } from "@haibun/core/lib/resources.js";
import { parseFilterParam, serializeFilterParam } from "./schemas.js";
import { SearchConditionSchema, type TSearchCondition } from "@haibun/core/lib/quad-types.js";
import * as ViewHash from "./view-hash.js";

type TAccessQueryLevel = z.infer<typeof AccessQueryLevelSchema>;

/** The query-owned hash params, each validated; `null` means absent. */
export const ViewQuerySchema = z.object({
	label: z.string().min(1).nullable().default(null),
	q: z.string().min(1).nullable().default(null),
	sort: z.string().min(1).nullable().default(null),
	order: z.enum(["asc", "desc"]).default("desc"),
	offset: z.number().int().nonnegative().default(0),
	access: AccessQueryLevelSchema.default(AccessQuery.all),
	f: z.array(SearchConditionSchema).default([]),
});
export type TViewQuery = z.infer<typeof ViewQuerySchema>;

const QUERY_PARAMS = ["label", "q", "sort", "order", "offset", "access", "f"] as const;

/** Parse + validate the query params out of a hash string. Throws (fail-fast) on a malformed param. */
export function parseViewQuery(hash: string): TViewQuery {
	const p = ViewHash.hashParams(hash);
	const offsetRaw = p.get("offset");
	return ViewQuerySchema.parse({
		label: p.get("label") || null,
		q: p.get("q") || null,
		sort: p.get("sort") || null,
		order: p.get("order") ?? undefined,
		offset: offsetRaw === null ? undefined : Number(offsetRaw),
		access: p.get("access") ?? undefined,
		f: p.getAll("f").map((s) => SearchConditionSchema.parse(parseFilterParam(s))),
	});
}

/** The query params as a URLSearchParams, defaults omitted so the round-trip is canonical. */
function queryParams(q: TViewQuery): URLSearchParams {
	const p = new URLSearchParams();
	if (q.label) p.set("label", q.label);
	if (q.q) p.set("q", q.q);
	if (q.sort) p.set("sort", q.sort);
	if (q.order !== "desc") p.set("order", q.order);
	if (q.offset > 0) p.set("offset", String(q.offset));
	// Omitted at the level a reader opens on, which util's appAccessLevel states: written for `private` and read back
	// as `all`, a reader's choice of one level was replaced by every level on the next reload.
	if (q.access !== AccessQuery.all) p.set("access", q.access);
	for (const c of q.f) if (c.predicate && c.value) p.append("f", serializeFilterParam(c));
	return p;
}

/** Canonical hash string for a view query alone (no pane/affordance params). */
export function serializeViewQuery(q: TViewQuery): string {
	const s = queryParams(q).toString();
	return s ? `#?${s}` : "";
}

// --- the globalThis-pinned signal store ---

const STORE_KEY = "__SHU_VIEW_QUERY__";
type ViewQueryStore = {
	label: Signal.State<string | null>;
	q: Signal.State<string | null>;
	sort: Signal.State<string | null>;
	order: Signal.State<"asc" | "desc">;
	offset: Signal.State<number>;
	access: Signal.State<TAccessQueryLevel>;
	f: Signal.State<TSearchCondition[]>;
	lastWrittenHash: string;
};

function store(): ViewQueryStore {
	const g = globalThis as unknown as Record<string, ViewQueryStore | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const d = ViewQuerySchema.parse({});
	const fresh: ViewQueryStore = {
		label: new Signal.State(d.label),
		q: new Signal.State(d.q),
		sort: new Signal.State(d.sort),
		order: new Signal.State(d.order),
		offset: new Signal.State(d.offset),
		access: new Signal.State<TAccessQueryLevel>(d.access),
		f: new Signal.State(d.f),
		lastWrittenHash: "",
	};
	g[STORE_KEY] = fresh;
	return fresh;
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

export const viewQuery = {
	/** The signal set, read `viewQuery.signals.q.get()` inside a render() to subscribe reactively. */
	get signals(): ViewQueryStore {
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
	hydrate(hash: string = ViewHash.getHash()): void {
		assign(parseViewQuery(hash));
		store().lastWrittenHash = hash;
	},

	/** Validate + apply a partial change and write the merged hash back, preserving pane/affordance params. */
	set(patch: Partial<TViewQuery>): void {
		const next = ViewQuerySchema.parse({ ...snapshot(), ...patch });
		assign(next);
		const merged = ViewHash.hashParams(ViewHash.getHash());
		for (const k of QUERY_PARAMS) merged.delete(k);
		for (const [k, v] of queryParams(next)) merged.append(k, v);
		const hash = merged.toString() ? `#?${merged.toString()}` : "";
		store().lastWrittenHash = hash;
		ViewHash.pushHash(hash);
	},
};
