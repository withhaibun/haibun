/**
 * Shared event-history backfill. `getEvents` returns only the most-recent events that fit a byte/count budget (so a long
 * run can't 413), reporting `truncated` and accepting an `until` (max-timestamp, inclusive) cursor. Every client that
 * needs history pages backward through this one helper — `shu-document-column`, `shu-monitor-column`, `shu-step-detail`,
 * and the windowed cache — rather than each reimplementing it. `fetchRange` is the windowed form; `fetchAllEvents` is the
 * whole-history case ([0, ∞)).
 */
import type { Range } from "./ranges.js";

type TEventPage = { events?: Array<Record<string, unknown>>; truncated?: boolean };
type FetchPage = (window: { since?: number; until?: number }) => Promise<TEventPage>;

const MAX_PAGES = 5000;
const eventTime = (e: Record<string, unknown>): number => Number(e.timestamp) || 0;
const pageKey = (e: Record<string, unknown>): string => `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined)}`;

/**
 * Walk `getEvents` backward via the `until` cursor, bounded to `[range.from, range.to)`, returning that span oldest-first
 * and de-duped (the inclusive cursor overlaps one event per page boundary). Starts at `range.to` (or the newest page for
 * the open live edge) and stops once a page reaches `range.from`. `fetchPage(window)` performs one RPC.
 */
export async function fetchRange(range: Range, fetchPage: FetchPage): Promise<Array<Record<string, unknown>>> {
	const pages: Array<Record<string, unknown>>[] = [];
	const since = range.from > 0 ? range.from : undefined; // omit since:0 so the whole-history call sends a bare filter
	let until: number | undefined = Number.isFinite(range.to) ? range.to : undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const { events = [], truncated } = await fetchPage({ ...(since === undefined ? {} : { since }), ...(until === undefined ? {} : { until }) });
		if (events.length === 0) break;
		pages.push(events.filter((e) => eventTime(e) >= range.from && eventTime(e) < range.to));
		const earliest = Math.min(...events.map(eventTime));
		if (earliest <= range.from || !truncated) break;
		if (until !== undefined && earliest >= until) break; // no backward progress — stop rather than loop
		until = earliest;
	}
	// Pages came newest-first; flatten oldest-first so events land chronologically, dropping the cursor overlap.
	const seen = new Set<string>();
	const all: Array<Record<string, unknown>> = [];
	for (let p = pages.length - 1; p >= 0; p--)
		for (const e of pages[p]) {
			const key = pageKey(e);
			if (seen.has(key)) continue;
			seen.add(key);
			all.push(e);
		}
	return all;
}

/** The whole history, oldest-first and de-duped — `fetchRange` over the full span. */
export function fetchAllEvents(fetchPage: FetchPage): Promise<Array<Record<string, unknown>>> {
	return fetchRange({ from: 0, to: Number.POSITIVE_INFINITY }, fetchPage);
}
