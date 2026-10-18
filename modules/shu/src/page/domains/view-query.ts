/**
 * viewQuery: the single, schema-validated source of truth for the URL-hash view/query state: the
 * type, text search, sort, pagination, access level, and compound filters that shu-graph-query and
 * the actions bar share. One signal per param, held by the page (so every importer on the page
 * shares one instance); reading `.get()` inside a lit render() auto-subscribes the view via the
 * SignalWatcher base. The URL hash is the durable store: `hydrate()` reads it at boot and on
 * back/forward, `set()` writes it back, so a reload restores the view.
 *
 * FAIL-FAST: every param is validated by {@link ViewQuerySchema}. A malformed enum / non-integer
 * offset / bad filter operator throws rather than silently resetting (without `|| default` or
 * `parseInt || 0`). The schema is the contract.
 *
 * SCOPE: this owns the QUERY params (label, q, sort, order, offset, access, f). The pane params
 * (col, active) and affordance deep-links (aff-goal, aff-waypoint) are still the pane machine's and
 * the affordances panel; `set()` merges its params over the live hash so those survive untouched,
 * letting them be migrated into this store incrementally.
 */
import { z } from "zod";
import { AccessQuery, AccessQueryLevelSchema } from "@haibun/core/lib/domains/resources.js";
import { SearchConditionSchema, SortOrderSchema } from "@haibun/core/lib/quad-types.js";

export type TAccessQueryLevel = z.infer<typeof AccessQueryLevelSchema>;

/** The query-owned hash params, each validated; `null` means absent. */
export const ViewQuerySchema = z.object({
	label: z.string().min(1).nullable().default(null),
	q: z.string().min(1).nullable().default(null),
	sort: z.string().min(1).nullable().default(null),
	order: SortOrderSchema.default("desc"),
	offset: z.number().int().nonnegative().default(0),
	access: AccessQueryLevelSchema.default(AccessQuery.all),
	f: z.array(SearchConditionSchema).default([]),
});
export type TViewQuery = z.infer<typeof ViewQuerySchema>;

export const QUERY_PARAMS = ["label", "q", "sort", "order", "offset", "access", "f"] as const;

/** A link that opens the query of a type actuality holds. */
export type THeldTypeLink = { label: string; href: string };

/** What a page shows for an address that names a type actuality doesn't hold: the cause, and a link to the query of each
 *  type actuality holds. An address outlives the actuality it was made in, so the page keeps the type the address names. */
export type TTypeNotHeld = { error: string; held: THeldTypeLink[] };
