/**
 * Shared event-history backfill. `getEvents` returns only the most-recent events that fit a byte/count
 * budget (so a long run can't 413), reporting `truncated` and accepting an `until` (max-timestamp,
 * inclusive) cursor. Every client that needs the full history pages backward through this one helper —
 * `shu-document-column`, `shu-monitor-column`, and `shu-step-detail` — rather than each reimplementing it.
 */

type TEventPage = { events?: Array<Record<string, unknown>>; truncated?: boolean };

const MAX_PAGES = 5000;

/**
 * Walk `getEvents` backward via the `until` cursor until nothing earlier remains, returning the full
 * history oldest-first and de-duped (the inclusive cursor overlaps one event per page boundary).
 * `fetchPage(window)` performs one RPC; `window` is `{}` for the newest page, then `{ until }`.
 */
export async function fetchAllEvents(fetchPage: (window: { until?: number }) => Promise<TEventPage>): Promise<Array<Record<string, unknown>>> {
	const pages: Array<Record<string, unknown>>[] = [];
	let until: number | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const { events = [], truncated } = await fetchPage(until === undefined ? {} : { until });
		if (events.length === 0) break;
		pages.push(events);
		if (!truncated) break;
		const earliest = Math.min(...events.map((e) => Number(e.timestamp) || 0));
		if (until !== undefined && earliest >= until) break; // no backward progress — stop rather than loop
		until = earliest;
	}
	// Pages came newest-first; flatten oldest-first so events land chronologically, dropping the overlap.
	const seen = new Set<string>();
	const all: Array<Record<string, unknown>> = [];
	for (let p = pages.length - 1; p >= 0; p--) {
		for (const e of pages[p]) {
			const key = `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			all.push(e);
		}
	}
	return all;
}
