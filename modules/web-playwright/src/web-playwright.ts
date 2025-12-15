import { Page, Download, Locator } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';

import { TWorld, OK, TStepResult, TFeatureStep, Origin, CycleWhen, TDomainDefinition } from '@haibun/core/lib/defs.js';
import { BrowserFactory, TTaggedBrowserFactoryOptions, TBrowserTypes, BROWSERS } from './BrowserFactory.js';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption, optionOrError } from '@haibun/core/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { EExecutionMessageType, TArtifactImage, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';

import { MonitorHandler } from './monitor/MonitorHandler.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';
import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { cycles } from './cycles.js';
import { interactionSteps } from './interactionSteps.js';
import { restSteps, TCapturedResponse } from './rest-playwright.js';
import { TwinPage } from './twin-page.js';
import { DOMAIN_STRING, registerDomains } from '@haibun/core/lib/domain-types.js';

type TWebPlaywrightSteps = ReturnType<typeof interactionSteps> & ReturnType<typeof restSteps>;
type TWebPlaywrightTypedSteps = ReturnType<typeof interactionSteps> & ReturnType<typeof restSteps>;

export const WEB_PAGE = 'webpage';
/**
 * This is the infrastructure for web-playwright.
 *
 * @see {@link interactionSteps} for interaction steps
 * @see {@link restSteps} for rest steps
 */


export const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
export const VISITED_PAGES = 'Visited pages';
export enum EMonitoringTypes {
	MONITOR_ALL = 'all',
	MONITOR_EACH = 'each',
}

type TRequestOptions = {
	headers?: Record<string, string>;
	postData?: string | URLSearchParams | FormData | Blob | ArrayBuffer | ArrayBufferView;
	userAgent?: string
};

export class WebPlaywright extends AStepper implements IHasOptions, IHasCycles {
	cycles = cycles(this);
	cyclesWhen = {
		startExecution: CycleWhen.FIRST - 1,
		startFeature: CycleWhen.FIRST - 1,
	};
	static PERSISTENT_DIRECTORY = 'PERSISTENT_DIRECTORY';
	options = {
		TWIN: {
			desc: `twin page elements based on interactions)`,
			parse: (input: string) => boolOrError(input),
		},
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
			dependsOn: [StepperKinds.STORAGE],
		},
		TIMEOUT: {
			desc: 'browser timeout for each step',
			parse: (input: string) => intOrError(input),
		},
		[StepperKinds.STORAGE]: {
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
	downloaded: string[] = [];
	captureVideo: boolean;
	closers: Array<() => void> = [];
	monitor: EMonitoringTypes;
	twin: boolean;
	monitorHandler?: MonitorHandler;
	twinPage?: TwinPage;
	apiUserAgent: string;
	extraHTTPHeaders: { [name: string]: string; } = {};
	expectedDownload: Promise<Download>;
	headless: boolean;
	inContainer: Locator;
	steppers: AStepper[];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		await super.setWorld(world, steppers);

		const args = [...(getStepperOption(this, 'ARGS', world.moduleOptions)?.split(';') || ''),]; //'--disable-gpu'
		this.storage = findStepperFromOption(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		this.headless = getStepperOption(this, 'HEADLESS', world.moduleOptions) === 'true' || !!process.env.CI;
		const devtools = getStepperOption(this, 'DEVTOOLS', world.moduleOptions) === 'true';
		if (devtools) {
			args.concat(['--auto-open-devtools-for-tabs', '--devtools-flags=panel-network', '--remote-debugging-port=9223']);
		}
		this.monitor = <EMonitoringTypes>getStepperOption(this, 'MONITOR', world.moduleOptions);
		this.twin = getStepperOption(this, 'TWIN', world.moduleOptions) === 'true';
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

		// Register visited-pages domain for tracking navigated URLs
		// This is an open domain (inherits from string) - visited URLs are added as members
		// Only register if not already registered (other tests may share the world)
		if (!world.domains[VISITED_PAGES]) {
			const visitedPagesDef: TDomainDefinition = {
				selectors: [VISITED_PAGES],
				schema: z.string(),
				coerce: (proto) => String(proto.value),
				description: 'Pages visited during test execution (auto-tracked by WebPlaywright)',
			};
			registerDomains(world, [[visitedPagesDef]]);
		}
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
		const containerPageOrFrame = this.inContainer || await this.getPage();

		if (!this.inContainer && this.twinPage) {
			await this.twinPage.patchPage(<Page>containerPageOrFrame);
		}

		const res = await f(containerPageOrFrame);
		return res;
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

	get typedSteps(): TWebPlaywrightTypedSteps {
		return { ...restSteps(this), ...interactionSteps(this) } as TWebPlaywrightTypedSteps;
	}

	steps: TWebPlaywrightSteps = {
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
			artifacts: [artifact],
			tag: this.getWorld().tag,
			incidentDetails: { ...details, event }
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
				const ret = await page.evaluate(async ({ endpoint, method, headers, postData: postDataForEval }) => {
					const fetchOptions: RequestInit = {
						method,
					};
					fetchOptions.headers = headers ? headers : {};
					if (postDataForEval) fetchOptions.body = postDataForEval as BodyInit;

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
			this.closers = [];
		}
	}
	async createTwin() {
		this.twinPage = new TwinPage(this, this.storage, this.headless);
		await this.twinPage.initTwin();
	}
	async createMonitor() {
		this.getWorld().logger.info('Creating new monitor page');
		this.monitorHandler = new MonitorHandler(this.getWorld(), this.storage, this.headless)
		await this.monitorHandler.initMonitorContext();

		return OK;
	}
	getLastResponse(): TCapturedResponse {
		return this.getWorld().shared.getJSON(LAST_REST_RESPONSE) as TCapturedResponse;
	}
	setLastResponse(serialized: TCapturedResponse, featureStep: TFeatureStep) {
		this.getWorld().shared.setJSON(LAST_REST_RESPONSE, serialized, Origin.var, featureStep);
	}
	locateByDomain(page: Page, featureStep: TFeatureStep, where: string) {
		const { value, domain } = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap[where], featureStep);
		const located = domain === DOMAIN_STRING ? page.getByText(<string>value, { exact: true }) : page.locator(<string>value);
		return located;
	}
}

export default WebPlaywright;
