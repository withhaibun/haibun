
import { TAnyFixme, TTag } from '@haibun/core/build/lib/defs.js';
import { ILogger, TArtifactMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { Page, Request, Route, Response } from 'playwright';

type TEtc = {
	headers: Record<string, string>;
	method?: string;
	postData?: string;
	status?: number;
	statusText?: string;
}

export type TPlaywrightTraceContent = {
	frameURL?: string;
	requestingPage?: string;
	requestingURL?: string;
	method?: string;
	headers?: Record<string, string>;
	postData?: TAnyFixme;
	status?: number;
	statusText?: string;
}

export type TPlaywrightTraceEvent = {
	content: TPlaywrightTraceContent;
	type: "json/playwright/trace";
}

export class PlaywrightEvents {
	constructor(private logger: ILogger, private page: Page, private tag: TTag) {
		this.logger.debug(`setPage ${JSON.stringify(tag)}`);
		page.on('request', this.logRequest.bind(this));
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		page.route('**/*', this.routeRequest.bind(this));
		page.on('response', this.logResponse.bind(this));
	}
	private async logRequest(request: Request, type = 'request'): Promise<void> {
		const frameURL = request.frame().url();
		const etc = {
			method: request.method(),
			headers: request.headers(),
			postData: request.postData(),
		}

		this.log(`${type} ${etc.method}`, frameURL, request.url(), etc);
		return Promise.resolve();
	}

	private async routeRequest(route: Route, request: Request): Promise<void> {
		await this.logRequest(request, 'route');
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		route.continue();
	}

	private async logResponse(response: Response): Promise<void> {
		const frameURL = response.request().frame().url();
		const etc = {
			status: response.status(),
			statusText: response.statusText(),
			headers: response.headers()
		}

		this.log(`response ${etc.status}`, frameURL, response.url(), etc);
		return Promise.resolve();
	}
	public close(): void {
		this.page.off('request', this.logRequest.bind(this));
		// Note: Playwright doesn't provide a direct way to remove a specific route handler
		this.page.off('response', this.logResponse.bind(this));
	}
	log(type: string, maybeFrameURL: string, targetURL: string, etc: TEtc) {
		const requestingPage = this.page.url();
		const frameURL = maybeFrameURL === requestingPage ? undefined : maybeFrameURL;
		const requestingURL = frameURL ? `frame ${frameURL} on ${requestingPage}` : requestingPage;
		const logData: TPlaywrightTraceContent = {
			frameURL,
			requestingPage,
			requestingURL,
			...etc
		};
		const requestingBase = requestingPage.replace(/\/[^/]*$/, '');
		const targetWithoutRequestingBase = targetURL.replace(requestingBase, '');

		const mc: TArtifactMessageContext = {
			topic: {
				stage: 'action',
				event: 'debug',
			},
			artifact: {
				content: logData,
				type: 'json/playwright/trace'
			}
		};
		this.logger.debug(`playwright ${type} ${logData.requestingURL} ➔ ${targetWithoutRequestingBase}`, mc);
	}
}
