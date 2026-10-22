/**
 * The observation sources of the browser's records: each host with the count of requests that reached it, each request with
 * its fields, and each page visited in order. Each reads its type's records in pages through `readRecords`, since a store
 * that holds every record of a type refuses a read of them all as quads at once.
 */
import { observedOf, type IObservationSource } from "@haibun/core/lib/astepper.js";
import { HTTP_HOST_LABEL, HTTP_REQUEST_LABEL, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { VISITED_PAGE_LABEL } from "../domains/web-playwright.js";

/** A record's own fields, without the fields a read's projection adds (`@id`, `@type` and those that start with `_`). */
const ownFields = (record: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(record).filter(([field]) => !field.startsWith("@") && !field.startsWith("_")));

export const HTTP_TRACE_SOURCES: IObservationSource[] = [
	{
		name: "http-trace hosts",
		// Each HttpHost record holds how many requests reached it.
		observe: async (world) =>
			(await readEvery(world.shared.getStore(), { label: HTTP_HOST_LABEL })).flatMap((host) => observedOf(String(host.id), { requestCount: host.requestCount })),
	},
	{
		name: "http-trace",
		// Each request record with every field it holds (status, durationMs, url, …): the nodes the network sequence reads,
		// so a quantifier states a rule such as `request/status is less than 400`.
		observe: async (world) => (await readEvery(world.shared.getStore(), { label: HTTP_REQUEST_LABEL })).flatMap((request) => observedOf(String(request.id), ownFields(request))),
	},
	{
		name: "visited pages",
		// Each VisitedPage record, in the order of its visit.
		observe: async (world) =>
			(await readEvery(world.shared.getStore(), { label: VISITED_PAGE_LABEL, sortBy: LinkRelations.GENERATED_AT_TIME.rel, sortOrder: "asc" })).map((page, index) => ({
				subject: String(page.name),
				predicate: "index",
				object: index,
			})),
	},
];
