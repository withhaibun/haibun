import { Page, Request, Route, Response } from 'playwright';

import { HttpTraceArtifact } from '@haibun/core/schema/protocol.js';
import { shortenURI } from '@haibun/core/lib/util/index.js';
import { TTag } from '@haibun/core/lib/ttag.js';
import { TWorld } from '@haibun/core/lib/defs.js';
import { Origin } from '@haibun/core/schema/protocol.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';
import { VISITED_PAGES } from './web-playwright.js';

type TEtc = {
	headers: Record<string, string>;
	method?: string;
	postData?: string;
	status?: number;
	statusText?: string;
}

export type THttpRequestObservation = {
	url: string;
	status: number;
	time: number;
	method: string;
}

export class PlaywrightEvents {
	navigateCount = 0;
	private pendingRequests = new Map<Request, number>();

	constructor(private world: TWorld, private page: Page, private tag: TTag) {
	}

	async init() {
		this.world.eventLogger.debug(`setPage ${JSON.stringify(this.tag)}`);
		this.page.on('request', this.logRequest.bind(this));
		// biome-disable-next-line @typescript-eslint/no-floating-promises
		await this.page.route('**/*', this.routeRequest.bind(this));
		this.page.on('response', this.logResponse.bind(this));
		this.page.on('framenavigated', this.framenavigated.bind(this));
		return this;
	}
	private logRequest(request: Request, type = 'request') {
		this.pendingRequests.set(request, Date.now());
		const frameURL = request.frame().url();
		const etc = {
			method: request.method(),
			headers: request.headers(),
			postData: request.postData(),
		}

		this.log(`${type} ${etc.method}`, <'request' | 'route'>type, frameURL, request.url(), etc);
		return;
	}

	private async routeRequest(route: Route, request: Request) {
		this.logRequest(request, 'route');
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
			headers: response.headers()
		}

		this.log(`response ${etc.status}`, 'response', frameURL, response.url(), etc);

		// Track detailed request metrics
		if (!this.world.runtime.observations) {
			this.world.runtime.observations = new Map();
		}
		const requests = this.world.runtime.observations.get('httpRequests') || new Map<string, THttpRequestObservation>();
		const count = requests.size;
		const id = `req-${count + 1}`;
		requests.set(id, {
			url: response.url(),
			status: response.status(),
			time: duration,
			method: request.method()
		});
		this.world.runtime.observations.set('httpRequests', requests);

		return;
	}
	private framenavigated(frame) {
		if (frame === this.page.mainFrame()) {
			const url = frame.url();
			const provenance = { in: 'PlaywrightEvents.framenavigated', seq: [], when: 'framenavigated' };

			this.world.shared.setForStepper('WebPlaywright', { term: 'currentURI', value: url, domain: DOMAIN_STRING, origin: Origin.var }, provenance);
			this.world.shared.setForStepper('WebPlaywright', { term: 'navigateCount', value: this.navigateCount, domain: DOMAIN_STRING, origin: Origin.var }, provenance);

			// Add to Visited pages domain for verification with 'every url in Visited pages is ...'
			const visitedKey = `visited/${this.navigateCount}`;
			this.world.shared.setForStepper('WebPlaywright', { term: visitedKey, value: url, domain: VISITED_PAGES, origin: Origin.var }, provenance);

			this.navigateCount++;
		}
	}
	public close(): void {
		this.page.off('request', this.logRequest.bind(this));
		// Note: Playwright doesn't provide a direct way to remove a specific route handler
		this.page.off('response', this.logResponse.bind(this));
	}
	async log(label: string, httpEvent: 'request' | 'response' | 'route', maybeFrameURL: string, targetURL: string, etc: TEtc) {
		const requestingPage = this.page.url();
		const frameURL = maybeFrameURL === requestingPage ? undefined : maybeFrameURL;
		const requestingURL = frameURL ? `frame ${frameURL} on ${requestingPage}` : requestingPage;
		const logData = {
			frameURL,
			requestingPage,
			requestingURL,
			...etc
		};

		// Track HTTP hosts for observation pattern
		try {
			const url = new URL(targetURL);
			const host = url.hostname;
			if (!this.world.runtime.observations) {
				this.world.runtime.observations = new Map();
			}
			const httpHosts = this.world.runtime.observations.get('httpHosts') || new Map<string, number>();
			httpHosts.set(host, (httpHosts.get(host) || 0) + 1);
			this.world.runtime.observations.set('httpHosts', httpHosts);
		} catch {
			// Invalid URL, skip tracking
		}

		// Emit HTTP trace artifact
		const artifact = HttpTraceArtifact.parse({
			id: `http-trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			timestamp: Date.now(),
			kind: 'artifact',
			artifactType: 'http-trace',
			level: 'debug',
			httpEvent,
			trace: logData
		});
		this.world.eventLogger.emit(artifact);
	}
}
