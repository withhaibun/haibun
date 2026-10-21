/** The observation sources of the browser's records: each host with the count of requests that reached it, each request with its fields, and each page visited in order. */
import type { IObservationSource } from "@haibun/core/lib/astepper.js";
import { HTTP_HOST_LABEL, HTTP_REQUEST_LABEL } from "@haibun/core/lib/domains/resources.js";
import { VISITED_PAGE_LABEL } from "../domains/web-playwright.js";

export const HTTP_TRACE_SOURCES: IObservationSource[] = [
	{
		name: "http-trace hosts",
		// Each HttpHost record holds how many requests reached it.
		observe: async (world) => await world.shared.getStore().query({ predicate: "requestCount", namedGraph: HTTP_HOST_LABEL }),
	},
	{
		name: "http-trace",
		// Each request record with every field it holds (status, durationMs, url, …): the nodes the network sequence reads,
		// so a quantifier states a rule such as `request/status is less than 400`.
		observe: async (world) => await world.shared.getStore().query({ namedGraph: HTTP_REQUEST_LABEL }),
	},
	{
		name: "visited pages",
		observe: async (world) => {
			// Each VisitedPage record, in the order of its visit.
			const quads = await world.shared.getStore().query({ predicate: "name", namedGraph: VISITED_PAGE_LABEL });
			return [...quads].sort((a, b) => a.timestamp - b.timestamp).map((quad, index) => ({ subject: String(quad.object), predicate: "index", object: index }));
		},
	},
];
