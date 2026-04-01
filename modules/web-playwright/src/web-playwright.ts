import { Page, Download, Locator } from "playwright";
import { pathToFileURL } from "url";

import { TWorld, TFeatureStep, CycleWhen, TStepAction } from "@haibun/core/lib/defs.js";
import { OK, TStepResult, Origin } from "@haibun/core/schema/protocol.js";
import { BrowserFactory, TTaggedBrowserFactoryOptions, TBrowserTypes, BROWSERS } from "./BrowserFactory.js";
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOptionOrKind, } from "@haibun/core/lib/util/index.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { ImageArtifact, VideoStartArtifact } from "@haibun/core/schema/protocol.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LABEL, DOMAIN_PAGE_PLACEHOLDER, DOMAIN_PAGE_ROLE, DOMAIN_PAGE_TITLE, DOMAIN_PAGE_ALT_TEXT, } from "./domains.js";

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from "@haibun/core/lib/astepper.js";

import { cycles } from "./cycles.js";
import { interactionSteps } from "./interactionSteps.js";
import { restSteps, TCapturedResponse } from "./rest-playwright.js";
import { jsonExtractSteps } from "./jsonExtractSteps.js";
import { TwinPage } from "./twin-page.js";

import { TStepperSteps } from "@haibun/core/lib/astepper.js";

export const WEB_PAGE = "webpage";
/**
 * This is the infrastructure for web-playwright.
 *
 * @see {@link interactionSteps} for interaction steps
 * @see {@link restSteps} for rest steps
 * @see {@link jsonExtractSteps} for JSON extraction steps
 */

export const LAST_REST_RESPONSE = "LAST_REST_RESPONSE";

type TRequestOptions = {
	headers?: Record<string, string>;
	postData?: string | URLSearchParams | FormData | Blob | ArrayBuffer | ArrayBufferView;
	userAgent?: string;
};

/** Callback function type for withPage - takes Page or Locator and returns TReturn */
export type TWithPageCallback<TReturn> = (pageOrLocator: Page | Locator) => TReturn | Promise<TReturn>;

export class WebPlaywright extends AStepper implements IHasOptions, IHasCycles {
	private static readonly DOM_READY_TIMEOUT_MS = 1900;
	private static readonly RENDER_SETTLE_MS = 200;

	private isTimeoutError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return error.name === "TimeoutError" || /timeout/i.test(error.message);
	}

	private async waitForDocumentReady(page: Page): Promise<void> {
		await page.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete", undefined, {
			timeout: WebPlaywright.DOM_READY_TIMEOUT_MS,
		});
	}

	async waitForLoaded(page: Page, mode: "navigation" | "settled" = "navigation") {
		try {
			if (mode === "navigation") {
				await page.waitForLoadState("domcontentloaded", { timeout: WebPlaywright.DOM_READY_TIMEOUT_MS });
			}
			await this.waitForDocumentReady(page);
			await page.waitForTimeout(WebPlaywright.RENDER_SETTLE_MS);
		} catch (e) {
			if (this.isTimeoutError(e)) {
				this.getWorld().eventLogger.debug(`waitForLoaded timed out (${mode}), continuing...`);
				return;
			}
			const message = e instanceof Error ? e.message : String(e);
			this.getWorld().eventLogger.warn(`waitForLoaded had error ${message}, continuing...`);
		}
	}
	description = "Navigate pages, click elements, fill forms, capture screenshots, and make REST API calls";

	cycles = cycles(this);
	cyclesWhen = {
		startExecution: CycleWhen.FIRST - 1,
		startFeature: CycleWhen.FIRST - 1,
	};
	static PERSISTENT_DIRECTORY = "PERSISTENT_DIRECTORY";
	options = {
		TWIN: {
			desc: `twin page elements based on interactions)`,
			parse: (input: string) => boolOrError(input),
		},

		HEADLESS: {
			desc: "run browsers without a window (true, false)",
			parse: (input: string) => boolOrError(input),
		},
		DEVTOOLS: {
			desc: `show browser devtools (true or false)`,
			parse: (input: string) => boolOrError(input),
		},
		[WebPlaywright.PERSISTENT_DIRECTORY]: {
			desc: "run browsers with a persistent directory (true or false)",
			parse: (input: string) => stringOrError(input),
		},
		ARGS: {
			desc: "pass arguments",
			parse: (input: string) => stringOrError(input),
		},
		CAPTURE_VIDEO: {
			desc: "capture video for every agent",
			parse: (input: string) => boolOrError(input),
			dependsOn: [StepperKinds.STORAGE],
		},
		TIMEOUT: {
			desc: "browser timeout for each step",
			parse: (input: string) => intOrError(input),
		},
		[StepperKinds.STORAGE]: {
			desc: "Storage for output",
			parse: (input: string) => stringOrError(input),
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

	twin: boolean;
	twinPage?: TwinPage;
	apiUserAgent: string;
	extraHTTPHeaders: { [name: string]: string } = {};
	expectedDownload: Promise<Download>;
	headless: boolean;
	inContainer: Locator;
	inContainerSelector: string;
	private videoStartEmitted = false;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);

		const args = [...(getStepperOption(this, "ARGS", world.moduleOptions)?.split(";") || "")]; //'--disable-gpu'
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		this.headless = !!process.env.CI || getStepperOption(this, "HEADLESS", world.moduleOptions) !== "false";
		const devtools = getStepperOption(this, "DEVTOOLS", world.moduleOptions) === "true";
		if (devtools) {
			args.concat(["--auto-open-devtools-for-tabs", "--devtools-flags=panel-network", "--remote-debugging-port=9223"]);
		}
		this.twin = getStepperOption(this, "TWIN", world.moduleOptions) === "true";
		const persistentDirectory = getStepperOption(this, WebPlaywright.PERSISTENT_DIRECTORY, world.moduleOptions);
		const defaultTimeout = parseInt(getStepperOption(this, "TIMEOUT", world.moduleOptions)) || 30000;
		this.captureVideo = getStepperOption(this, "CAPTURE_VIDEO", world.moduleOptions) === "true";
		let recordVideo;
		if (this.captureVideo) {
			recordVideo = {
				dir: await this.getCaptureDir("video"),
			};
		}

		const launchOptions = {
			headless: this.headless,
			args,
			devtools,
		};
		this.factoryOptions = {
			options: { recordVideo },
			browserType: BROWSERS.chromium,
			launchOptions,
			defaultTimeout,
			persistentDirectory,
		};
	}
	async getCaptureDir(type = "") {
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
		const world = this.getWorld();
		const { tag } = world;
		const isFirstPage = !this.bf?.hasPage(tag, this.tab);
		const page = await (await this.getBrowserFactory()).getBrowserContextPage(tag, this.tab);

		// Emit VideoStartArtifact when video capture starts (first page creation)
		if (this.captureVideo && isFirstPage && !this.videoStartEmitted) {
			this.videoStartEmitted = true;
			const videoStartEvent = VideoStartArtifact.parse({
				id: `feat-${tag.featureNum}.video-start`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "video-start",
				startTime: 0, // Relative offset from this moment
				level: "debug",
			});
			const featureStep = {
				seqPath: [tag.featureNum, 0, 0],
				source: { path: world.runtime.feature || "feature" },
				in: "video recording started",
				action: {} as TStepAction,
			};
			world.eventLogger.artifact(featureStep, videoStartEvent);
		}

		page.on("popup", async (popup: Page) => {
			await popup.waitForLoadState();
			// const title = await popup.title();
			this.newTab();

			this.bf.registerPopup(tag, this.tab, popup);
		});
		return page;
	}

	async withPage<TReturn>(f: TWithPageCallback<TReturn>): Promise<TReturn> {
		const containerPageOrFrame = this.inContainer || (await this.getPage());

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
		return actionNotOK(`Did not find text "${text}" in ${selector} (${textContent?.length} characters)`);
	}
	async getCookies() {
		const browserContext = await this.getExistingBrowserContext();
		return await browserContext?.cookies();
	}

	readonly typedSteps = { ...restSteps(this), ...interactionSteps(this) };
	steps: TStepperSteps = {
		...restSteps(this),
		...interactionSteps(this),
		...jsonExtractSteps(this),
	};
	setBrowser(browser: string) {
		this.factoryOptions.type = browser as unknown as TBrowserTypes;
		return OK;
	}
	newTab() {
		this.tab = this.tab + 1;
	}
	resetVideoStartEmitted() {
		this.videoStartEmitted = false;
	}
	async captureFailureScreenshot(event: string, step: TStepResult) {
		try {
			return await this.captureScreenshotAndLog(event, { step });
		} catch (e) {
			this.getWorld().eventLogger.debug(`captureFailureScreenshot error ${e}`);
		}
	}

	async captureScreenshotAndLog(event: string, details: { seq?: number; step?: TStepResult }) {
		const { path } = await this.captureScreenshot(event, details);
		this.getWorld().eventLogger.debug(`${event} screenshot to ${pathToFileURL(path)}`);
	}

	async captureScreenshot(event: string, details: { seq?: number; step?: TStepResult }) {
		const filename = `event-${details.step?.seqPath.join(".")}.png`;
		// Take screenshot to buffer first, then save
		const buffer = (await this.withPage(async (page: Page) => await page.screenshot())) as Buffer;
		const saved = await this.storage.saveArtifact(filename, buffer, EMediaTypes.image, "image");

		// Emit new-style artifact event with baseRelativePath for live serving
		const world = this.getWorld();
		const artifactEvent = ImageArtifact.parse({
			id: `${details.step.seqPath.join(".")}.artifact.0`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "image",
			path: saved.baseRelativePath,
			mimetype: "image/png",
		});
		const featureStep = {
			seqPath: details.step.seqPath,
			source: { path: details.step.path },
			in: details.step.in,
			action: {} as TStepAction,
		};
		world.eventLogger.artifact(featureStep, artifactEvent);

		return { path: saved.absolutePath };
	}

	async captureAccessibilitySnapshot() {
		return await this.withPage(async (page: Page) => {
			// Note: page.accessibility is deprecated in Playwright. Consider migrating to @axe-core/playwright
			const snapshot = await (
				page as unknown as { accessibility: { snapshot: (opts: Record<string, unknown>) => Promise<unknown> } }
			).accessibility.snapshot({
				interestingOnly: false,
			});
			return snapshot;
		});
	}

	async setExtraHTTPHeaders(headers: { [name: string]: string }) {
		await this.withPage(async () => {
			const browserContext = await this.getExistingBrowserContext();
			await browserContext.setExtraHTTPHeaders(headers);
			this.extraHTTPHeaders = headers;
		});
	}

	async withPageFetch(endpoint: string, method = "get", requestOptions: TRequestOptions = {}): Promise<TCapturedResponse> {
		const { headers, postData, userAgent } = requestOptions;
		const ua = userAgent || this.apiUserAgent;
		const page = await this.getPage();
		// FIXME Part I this could suffer from race conditions
		if (ua) {
			const browserContext = await this.getExistingBrowserContext();
			const headers = { ...(this.extraHTTPHeaders || {}), ...{ "User-Agent": ua } };
			await browserContext.setExtraHTTPHeaders(headers);
		}
		try {
			const pageConsoleMessages: { type: string; text: string }[] = [];
			try {
				page.on("console", (msg) => {
					pageConsoleMessages.push({ type: msg.type(), text: msg.text() });
				});
				const ret = await page.evaluate(
					async ({ endpoint, method, headers, postData: postDataForEval }) => {
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
							json: await response.json().catch((): null => null),
							text: await response.text().catch((): null => null),
						};

						return capturedResponse;
					},
					{ endpoint, method, headers, postData },
				);

				return ret;
			} catch (e) {
				throw new Error(
					`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${e.message}. Page console messages: ${pageConsoleMessages.map((msg) => `[${msg.type}] ${msg.text}`).join("; ")}`,
				);
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

	getLastResponse(): TCapturedResponse {
		const resolved = this.getWorld().shared.resolveVariable(
			{ term: LAST_REST_RESPONSE, origin: Origin.var },
			undefined,
			undefined,
			{ secure: true },
		);
		const val = resolved.value;
		return (typeof val === "string" ? JSON.parse(val) : val) as TCapturedResponse;
	}
	setLastResponse(serialized: TCapturedResponse, featureStep: TFeatureStep) {
		this.getWorld().shared.setJSON(LAST_REST_RESPONSE, serialized, Origin.var, featureStep);
	}
	locateByDomain(page: Page, featureStep: TFeatureStep, where: string) {
		const { value, domain } = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap[where], featureStep);
		const strValue = <string>value;

		// For union domains like "page-locator | string", extract the individual parts
		const domainParts = domain?.split(" | ").map((d) => d.trim()) ?? [];
		const effectiveDomain = domainParts.length === 1 ? domainParts[0] : pickLocatorDomain(domainParts);

		switch (effectiveDomain) {
			case DOMAIN_STRING:
				return page.getByText(strValue, { exact: true });
			case DOMAIN_PAGE_TEST_ID:
				return page.getByTestId(strValue);
			case DOMAIN_PAGE_LABEL:
				return page.getByLabel(strValue);
			case DOMAIN_PAGE_PLACEHOLDER:
				return page.getByPlaceholder(strValue);
			case DOMAIN_PAGE_ROLE:
				return page.getByRole(strValue as Parameters<Page["getByRole"]>[0]);
			case DOMAIN_PAGE_TITLE:
				return page.getByTitle(strValue);
			case DOMAIN_PAGE_ALT_TEXT:
				return page.getByAltText(strValue);
			default:
				// Default to CSS/XPath locator
				return page.locator(strValue);
		}
	}
}

/** For union domains, prefer string (getByText) over generic page-locator (CSS selector). */
export function pickLocatorDomain(parts: string[]): string {
	// Prefer string domain for text-based matching (most common for quoted values)
	if (parts.includes(DOMAIN_STRING)) return DOMAIN_STRING;
	// Then try specific locator domains
	const locatorDomains = [
		DOMAIN_PAGE_TEST_ID,
		DOMAIN_PAGE_LABEL,
		DOMAIN_PAGE_PLACEHOLDER,
		DOMAIN_PAGE_ROLE,
		DOMAIN_PAGE_TITLE,
		DOMAIN_PAGE_ALT_TEXT,
		DOMAIN_PAGE_LOCATOR,
	];
	for (const d of locatorDomains) {
		if (parts.includes(d)) return d;
	}
	return parts[0];
}

export default WebPlaywright;
