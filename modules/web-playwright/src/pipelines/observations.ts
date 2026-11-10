/**
 * The observation sources of the browser's records: each host with the count of requests that reached it, each request with
 * its fields, and each page visited in order, of those written by the observing step's start. Each reads its type's records
 * in pages through `readRecords`, since a store that holds every record of a type refuses a read of them all as quads at once.
 */
import { observedOf, type IObservationSource } from "@haibun/core/lib/astepper.js";
import { HTTP_HOST_LABEL, HTTP_REQUEST_LABEL, LinkRelations, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { readEndedBy } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { recordFieldsOf } from "@haibun/core/lib/quad-types.js";
import { VISITED_PAGE_LABEL, WebPlaywrightDomains } from "../domains/web-playwright.js";

/** The declaration of a type of the browser's records. */
function declared(label: string): TDomainDefinition {
	const found = WebPlaywrightDomains.find(({ selectors }) => selectors.includes(label));
	if (found === undefined) throw new Error(`web-playwright doesn't declare ${label}`);
	return found;
}

export const HTTP_TRACE_SOURCES: IObservationSource[] = [
	{
		name: "http-trace hosts",
		// Each HttpHost record holds how many requests reached it.
		observe: async (world, endedBy) =>
			(await readEndedBy(world.shared.getStore(), declared(HTTP_HOST_LABEL), endedBy, {})).flatMap((host) => observedOf(String(host.id), { requestCount: host.requestCount })),
	},
	{
		name: "http-trace",
		// Each request record with every field it holds (status, durationMs, url, …): the nodes the network sequence reads,
		// so a quantifier states a rule such as `request/status is less than 400`.
		observe: async (world, endedBy) =>
			(await readEndedBy(world.shared.getStore(), declared(HTTP_REQUEST_LABEL), endedBy, {})).flatMap((request) => observedOf(String(request.id), recordFieldsOf(request))),
	},
	{
		name: "visited pages",
		// Each VisitedPage record, in the order of its visit.
		observe: async (world, endedBy) =>
			(await readEndedBy(world.shared.getStore(), declared(VISITED_PAGE_LABEL), endedBy, { sortBy: LinkRelations.GENERATED_AT_TIME.rel, sortOrder: "asc" })).map((page, index) => ({
				subject: String(page.name),
				predicate: "index",
				object: index,
			})),
	},
];
