/**
 * The query params of an address: parsed and validated out of a hash, and serialized back without the defaults, so the
 * round-trip is canonical.
 */
import { AccessQuery } from "@haibun/core/lib/domains/resources.js";
import { ViewQuerySchema, type TViewQuery } from "../domains/view-query.js";
import * as Address from "./address.js";

/** Parse + validate the query params out of a hash string. Throws (fail-fast) on a malformed param. */
export function parseViewQuery(hash: string): TViewQuery {
	const p = Address.hashParams(hash);
	const offsetRaw = p.get("offset");
	return ViewQuerySchema.parse({
		label: p.get("label") || null,
		q: p.get("q") || null,
		sort: p.get("sort") || null,
		order: p.get("order") ?? undefined,
		offset: offsetRaw === null ? undefined : Number(offsetRaw),
		access: p.get("access") ?? undefined,
		x: p.get("x") || null,
	});
}

/** The query params as a URLSearchParams, defaults omitted so the round-trip is canonical. */
export function queryParams(q: TViewQuery): URLSearchParams {
	const p = new URLSearchParams();
	if (q.label) p.set("label", q.label);
	if (q.q) p.set("q", q.q);
	if (q.sort) p.set("sort", q.sort);
	if (q.order !== "desc") p.set("order", q.order);
	if (q.offset > 0) p.set("offset", String(q.offset));
	// Omitted at the level a reader opens on, which util's appAccessLevel states: written for `private` and read back
	// as `all`, a reader's choice of one level was replaced by every level on the next reload.
	if (q.access !== AccessQuery.all) p.set("access", q.access);
	if (q.x) p.set("x", q.x);
	return p;
}

/** Canonical hash string for a view query alone (without pane/affordance params). */
export function serializeViewQuery(q: TViewQuery): string {
	const params = queryParams(q);
	return params.toString() ? Address.hashOf(params) : "";
}
