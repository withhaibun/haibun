/**
 * What actuality records of a page's traffic: an HTTP trace artifact for each request and response it records, an
 * observation of each response, and for each navigation of the page's main frame the page's address, the count of its
 * navigations, and a VisitedPage record.
 */
import { DOMAIN_LINK, DOMAIN_NUMBER } from "@haibun/core/lib/domains/domains.js";
import { registeredPaths, type IRouteRegistry } from "@haibun/core/lib/execution.js";
import { trackHttpRequest } from "@haibun/core/lib/pipelines/http-observations.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { HttpTraceArtifact, Origin } from "@haibun/core/lib/domains/protocol.js";
import { WEBSERVER } from "@haibun/web-server-hono/domains/web-server.js";
import { WEB_PLAYWRIGHT } from "../domains/actions.js";
import { VISITED_PAGE_LABEL } from "../domains/web-playwright.js";
import { isRecorded } from "../derivations/http-exchange.js";
import type { TPageObserver, TPageRequest } from "../ports.js";

const PROVENANCE = { in: "PlaywrightEvents.framenavigated", seq: [] as number[], when: "framenavigated" };
const ID_RADIX = 36;

/** The trace of an exchange: the frame that made it where it isn't the page, the page, and the exchange's own fields. */
function traceOf({ frameUrl, pageUrl }: TPageRequest, fields: Record<string, unknown>) {
	const frameURL = frameUrl === pageUrl ? undefined : frameUrl;
	return { frameURL, requestingPage: pageUrl, requestingURL: frameURL === undefined ? pageUrl : `frame ${frameURL} on ${pageUrl}`, ...fields };
}

/** The observer of the page `pageKey` names among actuality's pages, whose visits carry ids that other pages' visits don't. */
export function pageObserver(world: TWorld, pageKey: string): TPageObserver {
	const registry = world.runtime[WEBSERVER] as IRouteRegistry | undefined;
	const routes = registry === undefined ? new Set<string>() : registeredPaths(registry);
	let navigateCount = 0;
	const failed = (what: string) => (error: unknown) => world.eventLogger.error(`recording ${what} of page ${pageKey} failed: ${errorDetail(error)}`);
	const trace = (httpEvent: "request" | "response", request: TPageRequest, fields: Record<string, unknown>) =>
		world.eventLogger.emit(
			HttpTraceArtifact.parse({
				id: `http-trace-${Date.now()}-${Math.random().toString(ID_RADIX).slice(2, 11)}`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "http-trace",
				level: "debug",
				httpEvent,
				trace: traceOf(request, fields),
			}),
		);
	return {
		request(request) {
			if (!isRecorded(request)) return;
			trace("request", request, { method: request.method, headers: request.headers, postData: request.postData });
		},
		response(response) {
			if (!isRecorded(response)) return;
			trace("response", response, { status: response.status, statusText: response.statusText, headers: response.headers });
			const { url, status, durationMs, method } = response;
			void trackHttpRequest(world, { url, status, durationMs, method }, routes).catch(failed(`the response from ${url}`));
		},
		navigated(url) {
			// A page event's listener doesn't wait, so each record is written in the background.
			void world.shared.setForStepper(WEB_PLAYWRIGHT, { term: "currentURI", value: url, domain: DOMAIN_LINK, origin: Origin.var }, PROVENANCE).catch(failed("the address"));
			void world.shared
				.setForStepper(WEB_PLAYWRIGHT, { term: "navigateCount", value: navigateCount, domain: DOMAIN_NUMBER, origin: Origin.var }, PROVENANCE)
				.catch(failed("the navigation count"));
			// One VisitedPage per navigation, by an id of its own rather than its address, so the record never shares an id with
			// shu's address-keyed columns; its name is the address without the view's hash, which names the page itself.
			const [name] = url.split("#");
			void world.shared
				.getStore()
				.upsertIndividual(VISITED_PAGE_LABEL, { id: `visit-${pageKey}-${navigateCount}`, name, generatedAtTime: new Date().toISOString() })
				.catch(failed(`the visit to ${url}`));
			navigateCount++;
		},
	};
}
