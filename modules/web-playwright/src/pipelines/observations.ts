/** The observation sources of the browser's records: each host with the count of requests that reached it, each request with its fields, and each page visited in order. */
import type { IObservationSource } from "@haibun/core/lib/astepper.js";
import { HTTP_HOST_LABEL, HTTP_REQUEST_LABEL } from "@haibun/core/lib/resources.js";
import { VISITED_PAGE_LABEL } from "../domains/web-playwright.js";

type TMetrics = Record<string, Record<string, unknown>>;

export const HTTP_TRACE_SOURCES: IObservationSource[] = [
	{
		name: "http-trace hosts",
		observe: async (world) => {
			// Each HttpHost record holds how many requests reached it.
			const quads = await world.shared.getStore().query({ predicate: "requestCount", namedGraph: HTTP_HOST_LABEL });
			return { items: quads.map((quad) => quad.subject), metrics: Object.fromEntries(quads.map((quad) => [quad.subject, { count: quad.object }])) };
		},
	},
	{
		name: "http-trace",
		observe: async (world) => {
			// Each request record with every field it holds (status, durationMs, url, …): the nodes the network sequence reads,
			// so a quantifier can state a rule such as `request/status is less than 400`.
			const quads = await world.shared.getStore().query({ namedGraph: HTTP_REQUEST_LABEL });
			const metrics: TMetrics = {};
			for (const { subject, predicate, object } of quads) metrics[subject] = { ...metrics[subject], [predicate]: object };
			return { items: Object.keys(metrics), metrics };
		},
	},
	{
		name: "visited pages",
		observe: async (world) => {
			// Each VisitedPage record, in the order of its visit.
			const quads = await world.shared.getStore().query({ predicate: "name", namedGraph: VISITED_PAGE_LABEL });
			const items = [...quads].sort((a, b) => a.timestamp - b.timestamp).map((quad) => String(quad.object));
			return { items, metrics: Object.fromEntries(items.map((item, index) => [item, { index }])) };
		},
	},
];
