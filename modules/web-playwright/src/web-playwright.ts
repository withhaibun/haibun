import { Page, Download } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { OK, TWorld, TStepResult } from '@haibun/core/build/lib/defs.js';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/core/build/lib/domain-types.js';
import { BrowserFactory, TTaggedBrowserFactoryOptions, TBrowserTypes, BROWSERS } from './BrowserFactory.js';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption, optionOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EExecutionMessageType, TArtifactImage, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

import { MonitorHandler } from './monitor/MonitorHandler.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { cycles } from './cycles.js';
import { interactionSteps } from './interactionSteps.js';
import { restSteps, TCapturedResponse } from './rest-playwright.js';

/**
 * This is the infrastructure for web-playwright.
 *
 * @see {@link interactionSteps} for interaction steps
 * @see {@link restSteps} for rest steps
 */

export const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
export enum EMonitoringTypes {
	MONITOR_ALL = 'all',
	MONITOR_EACH = 'each',
}

type TRequestOptions = {
	headers?: Record<string, string>;
	postData?: string | URLSearchParams | FormData | Blob | ArrayBuffer | ArrayBufferView;
	userAgent?: string
};

export class WebPlaywright extends AStepper implements IHasOptions {
	cycles = cycles(this);
	static STORAGE = 'STORAGE';
	static PERSISTENT_DIRECTORY = 'PERSISTENT_DIRECTORY';
	requireDomains = [WEB_PAGE, WEB_CONTROL];
	options = {
		MONITOR: {
			desc: `display a monitor with ongoing results (${EMonitoringTypes.MONITOR_ALL} or ${EMonitoringTypes.MONITOR_EACH})`,
			parse: (input: string) => optionOrError(input, [EMonitoringTypes.MONITOR_ALL, EMonitoringTypes.MONITOR_EACH]),
		},
		HEADLESS: {
			desc: 'run browsers without a window (true, false)',
			parse: (input: string) => boolOrError(input),
		},
		DEVTOOLS: {
			desc: `show browser devtools (true or false)`,
			parse: (input: string) => boolOrError(input),
		},
		[WebPlaywright.PERSISTENT_DIRECTORY]: {
			desc: 'run browsers with a persistent directory (true or false)',
			parse: (input: string) => stringOrError(input),
		},
		ARGS: {
			desc: 'pass arguments',
			parse: (input: string) => stringOrError(input),
		},
		CAPTURE_VIDEO: {
			desc: 'capture video for every agent',
			parse: (input: string) => boolOrError(input),
			dependsOn: ['STORAGE'],
		},
		TIMEOUT: {
			desc: 'browser timeout for each step',
			parse: (input: string) => intOrError(input),
		},
		[WebPlaywright.STORAGE]: {
			desc: 'Storage for output',
			parse: (input: string) => stringOrError(input),
			required: true
		},
	};
	hasFactory = false;
	bf?: BrowserFactory;
	storage?: AStorage;
	factoryOptions?: TTaggedBrowserFactoryOptions;
	tab = 0;
	withFrame: string;
	downloaded: string[] = [];
	captureVideo: boolean;
	closers: Array<() => Promise<void>> = [];
	monitor: EMonitoringTypes;
	static monitorHandler: MonitorHandler;
	apiUserAgent: string;
	extraHTTPHeaders: { [name: string]: string; } = {};
	expectedDownload: Promise<Download>;
	headless: boolean;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const args = [...(getStepperOption(this, 'ARGS', world.moduleOptions)?.split(';') || ''),]; //'--disable-gpu'
		this.storage = findStepperFromOption(steppers, this, world.moduleOptions, WebPlaywright.STORAGE);
		this.headless = getStepperOption(this, 'HEADLESS', world.moduleOptions) === 'true' || !!process.env.CI;
		const devtools = getStepperOption(this, 'DEVTOOLS', world.moduleOptions) === 'true';
		if (devtools) {
			args.concat(['--auto-open-devtools-for-tabs', '--devtools-flags=panel-network', '--remote-debugging-port=9223']);
		}
		this.monitor = <EMonitoringTypes>getStepperOption(this, 'MONITOR', world.moduleOptions);
		const persistentDirectory = getStepperOption(this, WebPlaywright.PERSISTENT_DIRECTORY, world.moduleOptions);
		const defaultTimeout = parseInt(getStepperOption(this, 'TIMEOUT', world.moduleOptions)) || 30000;
		this.captureVideo = getStepperOption(this, 'CAPTURE_VIDEO', world.moduleOptions) === 'true';
		let recordVideo;
		if (this.captureVideo) {
			recordVideo = {
				dir: await this.getCaptureDir('video'),
			};
		}

		const launchOptions = {
			headless: this.headless,
			args,
			devtools,
		}
		this.factoryOptions = {
			options: { recordVideo, },
			browserType: BROWSERS.chromium,
			launchOptions,
			defaultTimeout,
			persistentDirectory,
		};
	}
	async getCaptureDir(type = '') {
		const loc = { ...this.world, mediaType: EMediaTypes.video };
		const dir = await this.storage.ensureCaptureLocation(loc, type);
		return dir;
	}

	async getBrowserFactory(): Promise<BrowserFactory> {
		if (!this.hasFactory) {
			this.bf = await BrowserFactory.getBrowserFactory(this.getWorld(), this.factoryOptions);
			this.hasFactory = true;
		}
		return this.bf;
	}

	async getExistingBrowserContext(tag = this.getWorld().tag) {
		const browserContext = (await this.getBrowserFactory()).getExistingBrowserContextWithTag(tag);
		return browserContext;
	}

	async getPage() {
		const { tag } = this.getWorld();
		const page = await (await this.getBrowserFactory()).getBrowserContextPage(tag, this.tab);
		page.on('popup', async (popup: Page) => {
			await popup.waitForLoadState();
			// const title = await popup.title();
			this.newTab();

			this.bf.registerPopup(tag, this.tab, popup);
		});
		return page;
	}

	async withPage<TReturn>(f: TAnyFixme): Promise<TReturn> {
		const page = this.withFrame ? (await this.getPage()).frameLocator(this.withFrame) : await this.getPage();
		this.withFrame && console.debug('using frame', this.withFrame);
		this.withFrame = undefined;
		return await f(page);
	}

	async sees(text: string, selector: string) {
		let textContent: string | null = null;
		// FIXME retry sometimes required?
		for (let a = 0; a < 2; a++) {
			textContent = await this.withPage(async (page: Page) => await page.textContent(selector, { timeout: 1e9 }));
			if (textContent?.toString().includes(text)) {
				return OK;
			}
		}
		const messageContext = { incident: EExecutionMessageType.ON_FAILURE, incidentDetails: { summary: `in ${textContent?.length} characters`, details: textContent } };
		return actionNotOK(`Did not find text "${text}" in ${selector}`, { messageContext });
	}
	async getCookies() {
		const browserContext = await this.getExistingBrowserContext();
		return await browserContext?.cookies();
	}
	steps = {
		...restSteps(this),
		...interactionSteps(this),
	};
	setBrowser(browser: string) {
		this.factoryOptions.type = browser as unknown as TBrowserTypes;
		return OK;
	}
	newTab() {
		this.tab = this.tab + 1;
	}
	async captureFailureScreenshot(event: EExecutionMessageType, step: TStepResult) {
		try {
			return await this.captureScreenshotAndLog(event, { step });
		} catch (e) {
			this.getWorld().logger.debug(`captureFailureScreenshot error ${e}`);
		}
	}

	async captureScreenshotAndLog(event: EExecutionMessageType, details: { seq?: number; step?: TStepResult }) {
		const { context, path } = await this.captureScreenshot(event, details,);
		this.getWorld().logger.log(`${event} screenshot to ${pathToFileURL(path)}`, context);
	}

	async captureScreenshot(event: EExecutionMessageType, details: { seq?: number; step?: TStepResult }) {
		const loc = await this.getCaptureDir('image');
		// FIXME shouldn't be fs dependant
		const path = resolve(this.storage.fromLocation(EMediaTypes.image, loc, `${event}-${Date.now()}.png`));
		await this.withPage(async (page: Page) => await page.screenshot({ path }));
		const artifact: TArtifactImage = { artifactType: 'image', path: await this.storage.getRelativePath(path) };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifact,
			tag: this.getWorld().tag,
			incidentDetails: { ...details, event } // Store original topic details if needed
		};
		return { context, path };
	}

	async captureAccessibilitySnapshot() {
		return await this.withPage(async (page: Page) => {
			const snapshot = await page.accessibility.snapshot({
				interestingOnly: false,
			});
			return snapshot;
		});
	}

	async setExtraHTTPHeaders(headers: { [name: string]: string; }) {
		await this.withPage(async () => {
			const browserContext = await this.getExistingBrowserContext();
			await browserContext.setExtraHTTPHeaders(headers);
			this.extraHTTPHeaders = headers;
		});
	}

	async withPageFetch(
		endpoint: string,
		method = 'get',
		requestOptions: TRequestOptions = {}
	): Promise<TCapturedResponse> {
		const { headers, postData, userAgent } = requestOptions;
		const ua = userAgent || this.apiUserAgent;
		const page = await this.getPage();
		// FIXME Part I this could suffer from race conditions
		if (ua) {
			const browserContext = await this.getExistingBrowserContext();
			const headers = { ...this.extraHTTPHeaders || {}, ...{ 'User-Agent': ua } };
			await browserContext.setExtraHTTPHeaders(headers);
		}
		try {
			const pageConsoleMessages: { type: string; text: string }[] = [];
			try {
				page.on('console', (msg) => {
					pageConsoleMessages.push({ type: msg.type(), text: msg.text() });
				});
				const ret = await page.evaluate(async ({ endpoint, method, headers, postData }) => {
					const fetchOptions: RequestInit = {
						method,
					};
					fetchOptions.headers = headers ? headers : {};
					if (postData) fetchOptions.body = postData;

					const response = await fetch(endpoint, fetchOptions);
					const capturedResponse: TCapturedResponse = {
						status: response.status,
						statusText: response.statusText,
						headers: Object.fromEntries(response.headers.entries()),
						url: response.url,
						json: await response.json().catch(() => null),
						text: await response.text().catch(() => null),
					};

					return capturedResponse;
				}, { endpoint, method, headers, postData });

				return ret;
			} catch (e) {
				throw new Error(`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${e.message}. Page console messages: ${pageConsoleMessages.map(msg => `[${msg.type}] ${msg.text}`).join('; ')}`);
			}
		} catch (e) {
			const ua = userAgent || this.apiUserAgent;
			throw new Error(`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${e.message}`);
		} finally {
			// FIXME Part II this could suffer from race conditions
			if (ua) {
				const browserContext = await this.getExistingBrowserContext();
				await browserContext.setExtraHTTPHeaders(this.extraHTTPHeaders);
			}
		}
	}
	async callClosers() {
		if (this.closers) {
			for (const closer of this.closers) {
				await closer();
			}
		}
	}
	createMonitor = async () => {
		if (WebPlaywright.monitorHandler && !WebPlaywright.monitorHandler.monitorPage.isClosed()) {
			this.getWorld().logger.info('Monitor is already running, bringing existing monitor to front');
			await WebPlaywright.monitorHandler.monitorPage.bringToFront();
			return OK;
		}

		this.getWorld().logger.info('Creating new monitor page');
		WebPlaywright.monitorHandler = new MonitorHandler(this.getWorld(), this.storage, this.headless)
		await WebPlaywright.monitorHandler.initMonitor();
		this.getWorld().logger.addSubscriber(WebPlaywright.monitorHandler.subscriber);

		this.closers.push(async () => {
			this.getWorld().logger.removeSubscriber(WebPlaywright.monitorHandler.subscriber);
			return Promise.resolve();
		});
		return OK;
	}
	getLastResponse(): TCapturedResponse {
		return this.getWorld().shared.getJSON(LAST_REST_RESPONSE) as TCapturedResponse;
	}
	setLastResponse(serialized: TCapturedResponse) {
		this.getWorld().shared.setJSON(LAST_REST_RESPONSE, serialized);
	}
}

export default WebPlaywright;
