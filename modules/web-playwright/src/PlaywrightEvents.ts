import { Page, Request, Route, Response } from 'playwright';

import { TArtifactHTTPTrace, THTTPTraceContent, EExecutionMessageType, TMessageContext } from '@haibun/core/lib/interfaces/logger.js'; // Updated imports
import { shortenURI } from '@haibun/core/lib/util/index.js';
import { TTag } from '@haibun/core/lib/ttag.js';
import { Origin, TWorld } from '@haibun/core/lib/defs.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';

type TEtc = {
	headers: Record<string, string>;
	method?: string;
	postData?: string;
	status?: number;
	statusText?: string;
}

export class PlaywrightEvents {
	navigateCount = 0;
	constructor(private world: TWorld, private page: Page, private tag: TTag) {
	}
	async init() {
		this.world.logger.debug(`setPage ${JSON.stringify(this.tag)}`);
		this.page.on('request', this.logRequest.bind(this));
		// biome-disable-next-line @typescript-eslint/no-floating-promises
		await this.page.route('**/*', this.routeRequest.bind(this));
		this.page.on('response', this.logResponse.bind(this));
		this.page.on('framenavigated', this.framenavigated.bind(this));
		return this;
	}
	private logRequest(request: Request, type = 'request') {
		const frameURL = request.frame().url();
		const etc = {
			method: request.method(),
			headers: request.headers(),
			postData: request.postData(),
		}

		this.log(`${type} ${etc.method}`, <TArtifactHTTPTrace['httpEvent']>type, frameURL, request.url(), etc);
		return;
	}

	private async routeRequest(route: Route, request: Request) {
		this.logRequest(request, 'route');
		// biome-disable-next-line @typescript-eslint/no-floating-promises
		await route.continue();
	}

	private logResponse(response: Response) {
		const frameURL = response.request().frame().url();
		const etc = {
			status: response.status(),
			statusText: response.statusText(),
			headers: response.headers()
		}

		this.log(`response ${etc.status}`, 'response', frameURL, response.url(), etc);
		return;
	}
	private framenavigated(frame) {
		if (frame === this.page.mainFrame()) {
			this.world.shared.setForStepper('WebPlaywright', { term: 'currentURI', value: frame.url(), domain: DOMAIN_STRING, origin: Origin.var }, { in: 'PlaywrightEvents.framenavigated', seq: [], when: 'framenavigated' });
			this.world.shared.setForStepper('WebPlaywright', { term: 'navigateCount', value: this.navigateCount++, domain: DOMAIN_STRING, origin: Origin.var }, { in: 'PlaywrightEvents.framenavigated', seq: [], when: 'framenavigated' });
		}
	}
	public close(): void {
		this.page.off('request', this.logRequest.bind(this));
		// Note: Playwright doesn't provide a direct way to remove a specific route handler
		this.page.off('response', this.logResponse.bind(this));
	}
	log(label: string, httpEvent: TArtifactHTTPTrace['httpEvent'], maybeFrameURL: string, targetURL: string, etc: TEtc) {
		const requestingPage = this.page.url();
		const frameURL = maybeFrameURL === requestingPage ? undefined : maybeFrameURL;
		const requestingURL = frameURL ? `frame ${frameURL} on ${requestingPage}` : requestingPage;
		const logData: THTTPTraceContent = {
			frameURL,
			requestingPage,
			requestingURL,
			...etc
		};
		const requestingBase = requestingPage.replace(/\/[^/]*$/, '');
		const targetWithoutRequestingBase = targetURL.replace(requestingBase, '');
		const artifact: TArtifactHTTPTrace = {
			httpEvent,
			trace: logData,
			artifactType: 'json/http/trace'
		}
		const mc: TMessageContext = {
			incident: EExecutionMessageType.TRACE,
			artifacts: [artifact],
			tag: this.tag
		};
		this.world.logger.debug(`playwright ${label} ${shortenURI(logData.requestingURL)} ➔ ${targetWithoutRequestingBase}`, mc);
	}
}
