import { Page, Request, Route, Response } from "playwright";

import { HttpTraceArtifact } from "@haibun/core/schema/protocol.js";
import { TTag } from "@haibun/core/lib/ttag.js";
import { TWorld } from "@haibun/core/lib/defs.js";
import { Origin } from "@haibun/core/schema/protocol.js";
import { DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import { trackHttpHost, trackHttpRequest } from "@haibun/core/lib/http-observations.js";

type TEtc = {
	headers: Record<string, string>;
	method?: string;
	postData?: string;
	status?: number;
	statusText?: string;
};

export class PlaywrightEvents {
	navigateCount = 0;
	private pendingRequests = new Map<Request, number>();

	constructor(
		private world: TWorld,
		private page: Page,
		private tag: TTag,
	) {}

	async init() {
		this.world.eventLogger.debug(`setPage ${JSON.stringify(this.tag)}`);
		this.page.on("request", this.logRequest.bind(this));
		// biome-disable-next-line @typescript-eslint/no-floating-promises
		await this.page.route("**/*", this.routeRequest.bind(this));
		this.page.on("response", this.logResponse.bind(this));
		this.page.on("framenavigated", this.framenavigated.bind(this));
		return this;
	}
	private logRequest(request: Request, type = "request") {
		this.pendingRequests.set(request, Date.now());
		const frameURL = request.frame().url();
		const etc = {
			method: request.method(),
			headers: request.headers(),
			postData: request.postData(),
		};

		void this.log(`${type} ${etc.method}`, <"request" | "route">type, frameURL, request.url(), etc);
		return;
	}

	private async routeRequest(route: Route, request: Request) {
		this.logRequest(request, "route");
		// biome-disable-next-line @typescript-eslint/no-floating-promises
		await route.continue();
	}

	private logResponse(response: Response) {
		const request = response.request();
		const startTime = this.pendingRequests.get(request);
		const duration = startTime ? Date.now() - startTime : 0;
		if (startTime) {
			this.pendingRequests.delete(request);
		}

		const frameURL = request.frame().url();
		const etc = {
			status: response.status(),
			statusText: response.statusText(),
			headers: response.headers(),
		};

		void this.log(`response ${etc.status}`, "response", frameURL, response.url(), etc);

		// Track request using shared helper
		trackHttpRequest(this.world, {
			url: response.url(),
			status: response.status(),
			time: duration,
			method: request.method(),
		});

		return;
	}
	private framenavigated(frame: import("playwright").Frame) {
		if (frame === this.page.mainFrame()) {
			const url = frame.url();
			const provenance = { in: "PlaywrightEvents.framenavigated", seq: [] as number[], when: "framenavigated" };

			// fire-and-forget: sync event handler cannot await; in-memory QuadStore resolves synchronously
			void this.world.shared.setForStepper("WebPlaywright", { term: "currentURI", value: url, domain: DOMAIN_LINK, origin: Origin.var }, provenance);
			void this.world.shared.setForStepper("WebPlaywright", { term: "navigateCount", value: this.navigateCount, domain: DOMAIN_NUMBER, origin: Origin.var }, provenance);

			const visitedPages = (this.world.runtime.observations.get("visitedPages") as string[]) || [];
			visitedPages.push(url);
			this.world.runtime.observations.set("visitedPages", visitedPages);

			this.navigateCount++;
		}
	}
	public close(): void {
		this.page.off("request", this.logRequest.bind(this));
		// Note: Playwright doesn't provide a direct way to remove a specific route handler
		this.page.off("response", this.logResponse.bind(this));
	}
	log(label: string, httpEvent: "request" | "response" | "route", maybeFrameURL: string, targetURL: string, etc: TEtc) {
		const requestingPage = this.page.url();
		const frameURL = maybeFrameURL === requestingPage ? undefined : maybeFrameURL;
		const requestingURL = frameURL ? `frame ${frameURL} on ${requestingPage}` : requestingPage;
		const logData = {
			frameURL,
			requestingPage,
			requestingURL,
			...etc,
		};

		// Track HTTP hosts using shared helper
		trackHttpHost(this.world, targetURL);

		// Emit HTTP trace artifact
		const artifact = HttpTraceArtifact.parse({
			id: `http-trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "http-trace",
			level: "debug",
			httpEvent,
			trace: logData,
		});
		this.world.eventLogger.emit(artifact);
	}
}
