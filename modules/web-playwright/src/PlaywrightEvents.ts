
import { TTag } from '@haibun/core/build/lib/defs.js';
import { ILogger, TArtifactMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { Page, Request, Route, Response } from 'playwright';

export class PlaywrightEvents {
    page: Page;
    tag: TTag;
    logger: ILogger;

    constructor(logger: ILogger, page: Page, tag: TTag) {
        this.logger = logger;
        this.page = page;
        this.logger.log(`setPage ${tag}`);
        this.tag = tag;
        page.on('request', this.logRequest.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        page.route('**/*', this.routeRequest.bind(this));
        page.on('response', this.logResponse.bind(this));
    }
    private async logRequest(request: Request, type = 'request'): Promise<void> {
        const frameURL = request.frame().url();
        const currentPageURL = this.page.url();
        const requestingURL = frameURL === currentPageURL ? currentPageURL : `Frame: ${frameURL}`;
        const targetURL = request.url();
        const method = request.method();
        const headers = request.headers();
        const postData = request.postData();

        const logData = {
            requestingURL,
            targetURL,
            method,
            headers,
            postData
        };

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
        this.logger.debug(`playwright ${type}`, mc);
    }

    private async routeRequest(route: Route, request: Request): Promise<void> {
        await this.logRequest(request, 'route');
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        route.continue();
    }

    private async logResponse(response: Response): Promise<void> {
        const frameURL = response.request().frame().url();
        const currentPageURL = this.page.url();
        const requestingURL = frameURL === currentPageURL ? currentPageURL : `Frame: ${frameURL}`;
        const targetURL = response.url();
        const status = response.status();
        const statusText = response.statusText();
        const headers = response.headers();

        const logData = {
            requestingURL,
            targetURL,
            status,
            statusText,
            headers
        };

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
        this.logger.debug(`playwright response`, mc);
    }
    public close(): void {
        this.page.off('request', this.logRequest.bind(this));
        // Note: Playwright doesn't provide a direct way to remove a specific route handler
        this.page.off('response', this.logResponse.bind(this));
    }
}
