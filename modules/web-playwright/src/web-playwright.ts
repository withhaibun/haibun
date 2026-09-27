import { Page, Download, Locator, type ConnectOverCDPTransport, type Worker } from "playwright";
import { pathToFileURL } from "url";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

import type { TWorld } from "@haibun/core/lib/world.js";
import { TFeatureStep, CycleWhen, TStepAction } from "@haibun/core/lib/astepper.js";
import { OK, TStepResult, Origin, type TStepValue } from "@haibun/core/schema/protocol.js";
import { BrowserFactory, TTaggedBrowserFactoryOptions, TBrowserTypes, BROWSERS } from "./BrowserFactory.js";
import {
	actionNotOK,
	actionOKWithProducts,
	getStepperOption,
	boolOrError,
	intOrError,
	stringOrError,
	findStepperFromOptionOrKind,
	errorDetail,
} from "@haibun/core/lib/util/index.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { saveImageArtifact } from "@haibun/domain-storage/image-artifact.js";
import { VideoStartArtifact } from "@haibun/core/schema/protocol.js";
import { EMediaTypes, MAPPED_MEDIA_TYPES } from "@haibun/domain-storage/media-types.js";
import type { TImageReference } from "@haibun/core/lib/image-reference.js";
import { artifactAddress } from "@haibun/core/lib/run-artifact.js";
import { DOMAIN_STRING, domainParts } from "@haibun/core/lib/domains.js";
import {
	DOMAIN_PAGE_LOCATOR,
	DOMAIN_PAGE_TEST_ID,
	DOMAIN_PAGE_LABEL,
	DOMAIN_PAGE_PLACEHOLDER,
	DOMAIN_PAGE_ROLE,
	DOMAIN_PAGE_TITLE,
	DOMAIN_PAGE_ALT_TEXT,
	DOMAIN_PAGE_TEXT,
} from "./domains.js";
import { AStepper, IHasCycles, IHasOptions, StepperKinds } from "@haibun/core/lib/astepper.js";

import { cycles } from "./cycles.js";
import { interactionSteps } from "./interactionSteps.js";
import { CapturedResponseSchema, restSteps, type TCapturedResponse, type TJsonResponse } from "./rest-playwright.js";
import { fromJsonText } from "@haibun/core/lib/json-text.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { TwinPage } from "./twin-page.js";
import { WEBSERVER, type IWebServer } from "@haibun/web-server-hono/defs.js";
import { BrowserRelay } from "./relay/cdpRelay.js";
import { relayMethods } from "./relay/relay-methods.js";
import { RELAY_METHOD_PREFIX } from "./relay/relay-wire.js";
import { WEB_PLAYWRIGHT_ACTIONS } from "./actions.js";

import { TStepperSteps } from "@haibun/core/lib/astepper.js";

export const WEB_PAGE = "webpage";
/** The media type a screenshot is saved in. */
const SCREENSHOT_FORMAT = MAPPED_MEDIA_TYPES.png;

/**
 * This is the infrastructure for web-playwright.
 *
 * @see {@link interactionSteps} for interaction steps
 * @see {@link restSteps} for rest steps
 */

const LAST_REST_RESPONSE = "LAST_REST_RESPONSE";

type TRequestOptions = {
	headers?: Record<string, string>;
	postData?: string | URLSearchParams | FormData | Blob | ArrayBuffer | ArrayBufferView;
	userAgent?: string;
};

/** Callback function type for withPage - takes Page or Locator and returns TReturn */
/** Where a step finds elements: within the container `in {container}, {what}` names, or on the page. */
export type TPageScope = Page | Locator;
type TWithPageCallback<TReturn> = (page: Page) => TReturn | Promise<TReturn>;

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
			const message = errorDetail(e);
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
			desc: "the directory a launched browser keeps its profile in, across runs",
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
	bf?: BrowserFactory;
	#storage?: AStorage;
	#factoryOptions?: TTaggedBrowserFactoryOptions;
	get storage(): AStorage {
		return this.madeWithWorld(this.#storage, "storage");
	}
	get factoryOptions(): TTaggedBrowserFactoryOptions {
		return this.madeWithWorld(this.#factoryOptions, "browser options");
	}
	tab = 0;
	/** The relay a person's browser attaches through, where the run serves one. */
	relay?: BrowserRelay;
	/** The extension the browser the run launches loads, and what its manifest declares it runs. */
	extension?: TLoadedExtension;
	downloaded: string[] = [];
	captureVideo = false;
	closers: Array<() => void> = [];
	/** Uncaught browser exceptions (page `pageerror`) seen since the current feature started. The afterStep
	 *  cycle fails the step one occurred during, so a browser-side throw surfaces as a real failure instead of
	 *  a downstream blind timeout. Reset per feature. */
	browserErrors: string[] = [];
	/** Count of browserErrors at the start of the current step (set by the beforeStep cycle). */
	errorMark = 0;
	#boundPages = new WeakSet<Page>();
	/** The pages the current call chain holds, so an action nested in another doesn't wait behind it. */
	#holding = new AsyncLocalStorage<Set<Page>>();
	/** The last action queued on each page. */
	#queues = new WeakMap<Page, Promise<unknown>>();

	twin = false;
	twinPage?: TwinPage;
	apiUserAgent?: string;
	extraHTTPHeaders: { [name: string]: string } = {};
	expectedDownload?: Promise<Download>;
	headless = true;
	inContainer?: Locator;
	private videoStartEmitted = false;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);

		const args = [...(getStepperOption(this, "ARGS", world.moduleOptions)?.split(";") || "")]; //'--disable-gpu'
		this.#storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		this.headless = !!process.env.CI || getStepperOption(this, "HEADLESS", world.moduleOptions) !== "false";
		const devtools = getStepperOption(this, "DEVTOOLS", world.moduleOptions) === "true";
		if (devtools) {
			args.push("--auto-open-devtools-for-tabs", "--devtools-flags=panel-network", "--remote-debugging-port=9223");
		}
		this.twin = getStepperOption(this, "TWIN", world.moduleOptions) === "true";
		const persistentDirectory = getStepperOption(this, WebPlaywright.PERSISTENT_DIRECTORY, world.moduleOptions);
		const defaultTimeout = parseInt(getStepperOption(this, "TIMEOUT", world.moduleOptions) ?? "", 10) || 30000;
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
		this.#factoryOptions = {
			options: { recordVideo },
			browserType: BROWSERS.chromium,
			launchOptions,
			defaultTimeout,
			persistentDirectory,
		};
	}
	async getCaptureDir(type = "") {
		const loc = { ...this.getWorld(), mediaType: EMediaTypes.video };
		const dir = await this.storage.ensureCaptureLocation(loc, type);
		return dir;
	}

	async getBrowserFactory(): Promise<BrowserFactory> {
		this.bf ??= BrowserFactory.getBrowserFactory(this.getWorld(), this.factoryOptions);
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
		const bf = await this.getBrowserFactory();
		const page = await bf.getBrowserContextPage(tag, this.tab);

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

		if (!this.#boundPages.has(page)) {
			this.#boundPages.add(page); // bind once per page, getPage is called per action
			page.on("popup", async (popup: Page) => {
				await popup.waitForLoadState();
				this.newTab();
				bf.registerPopup(tag, this.tab, popup);
			});
			// An adopted page's errors are its owner's browsing, not the run's.
			if (!bf.isAdopted(page)) page.on("pageerror", (err: Error) => this.browserErrors.push(err?.message ?? String(err)));
		}
		return page;
	}

	/** Runs one action on the page, after any action another caller is running on it: every caller of a running
	 *  instance shares its page. An action nested in another, such as the steps `in {container}, {what}` runs, holds
	 *  the page already and runs at once. Within a container, the page is the container's page. */
	async withPage<TReturn>(f: TWithPageCallback<TReturn>): Promise<TReturn> {
		const page = this.inContainer ? this.inContainer.page() : await this.getPage();
		const held = this.#holding.getStore();
		if (held?.has(page)) return await this.#act(page, f);
		const turn = (this.#queues.get(page) ?? Promise.resolve()).then(() => this.#holding.run(new Set([...(held ?? []), page]), () => this.#act(page, f)));
		this.#queues.set(
			page,
			turn.catch((): void => undefined),
		);
		return await turn;
	}

	/** Runs one action where a step finds elements, as `withPage` runs one on the page. */
	async withScope<TReturn>(f: (scope: TPageScope) => TReturn | Promise<TReturn>): Promise<TReturn> {
		return await this.withPage((page) => f(this.inContainer ?? page));
	}

	async #act<TReturn>(page: Page, f: TWithPageCallback<TReturn>): Promise<TReturn> {
		if (!this.inContainer && this.twinPage) await this.twinPage.patchPage(page);
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
	};
	setBrowser(browser: TBrowserTypes) {
		this.factoryOptions.browserType = BROWSERS[browser];
		return OK;
	}
	/** Drives a running browser from the next page the run opens, instead of launching one: the one at a CDP endpoint, or
	 *  the one attached through the relay, reached through the transport it makes. */
	connectTo(cdp: string | (() => ConnectOverCDPTransport)) {
		const named = typeof cdp === "string" ? cdp : "the attached browser";
		if (this.bf?.hasPage(this.getWorld().tag, this.tab)) return actionNotOK(`connect to a browser before any step opens a page; ${named} was named after one`);
		const launchOnly = { CAPTURE_VIDEO: this.captureVideo, TWIN: this.twin, [WebPlaywright.PERSISTENT_DIRECTORY]: this.factoryOptions.persistentDirectory !== undefined };
		const set = Object.entries(launchOnly)
			.filter(([, on]) => on)
			.map(([name]) => name);
		if (set.length > 0) return actionNotOK(`a connected browser takes no ${set.join(", ")}: each configures a browser the run launches`);
		this.factoryOptions.cdp = cdp;
		return OK;
	}

	/** Load the unpacked extension at `where` into the browser the run launches, from the next page it opens. An extension
	 *  loads only into a browser with a profile of its own, which is the one `PERSISTENT_DIRECTORY` names or else one
	 *  Playwright makes for the browser and removes when it closes, and only into Chromium's full browser, whose headless
	 *  mode loads extensions where the headless shell doesn't. Its id is the one its manifest's pinned key derives, so a
	 *  step can open its pages. */
	loadExtension(where: string) {
		if (this.bf?.hasPage(this.getWorld().tag, this.tab)) return actionNotOK(`load an extension before any step opens a page; ${where} was named after one`);
		if (this.factoryOptions.cdp !== undefined) return actionNotOK("an extension loads into a browser the run launches, and this run connects to one");
		const dir = path.resolve(where);
		const manifest = path.join(dir, "manifest.json");
		if (!existsSync(manifest)) return actionNotOK(`no extension at ${dir}: it has no manifest.json`);
		const { key, background, side_panel } = JSON.parse(readFileSync(manifest, "utf-8")) as { key?: unknown; background?: { service_worker?: string }; side_panel?: unknown };
		if (typeof key !== "string") return actionNotOK(`the extension at ${dir} pins no key in its manifest, so its id isn't known before it loads`);
		this.factoryOptions.persistentDirectory ??= "";
		const args = (this.factoryOptions.launchOptions.args ?? []).filter(Boolean);
		this.factoryOptions.launchOptions = {
			...this.factoryOptions.launchOptions,
			channel: "chromium",
			args: [...args, `--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
		};
		const id = extensionIdOf(key);
		const loaded = { id, origin: `chrome-extension://${id}` };
		this.extension = { ...loaded, worker: !!background?.service_worker, sidePanel: side_panel !== undefined };
		return actionOKWithProducts(loaded);
	}

	/** The extension the browser runs: its worker, once it has started, and the side panel its toolbar button opens, as the
	 *  worker reads it. A worker that doesn't start within the step's timeout fails the step, so an extension whose worker
	 *  fails to load fails it. */
	async runningExtension() {
		const { extension } = this;
		if (!extension) return actionNotOK("the run hasn't loaded a browser extension: `load the browser extension at` loads one");
		const { id, origin } = extension;
		if (!extension.worker) return actionOKWithProducts({ id, origin });
		const context = (await this.getPage()).context();
		const ours = (worker: Worker) => worker.url().startsWith(origin);
		const worker = context.serviceWorkers().find(ours) ?? (await context.waitForEvent("serviceworker", { predicate: ours }));
		const sidePanel = extension.sidePanel ? await worker.evaluate(readSidePanel) : undefined;
		return actionOKWithProducts({ id, origin, worker: worker.url(), ...(sidePanel ? { sidePanel } : {}) });
	}

	/** Serve the relay an extension attaches a person's browser through, and drive that browser from the next page the
	 *  run opens. With no browser attached, a step that needs the browser is refused, saying so. */
	serveRelay() {
		const webserver = this.getWorld().runtime[WEBSERVER] as IWebServer | undefined;
		if (!webserver) return actionNotOK("the browser relay is served by the web server, and none is running: start one before serving the relay");
		const relay = new BrowserRelay((error) => this.getWorld().eventLogger.error(`browser relay: ${errorDetail(error)}`));
		this.relay = relay;
		webserver.addRpcMethods(
			RELAY_METHOD_PREFIX,
			{ description: "The browser a person runs, attached through their extension" },
			relayMethods(relay, WEB_PLAYWRIGHT_ACTIONS.attach),
		);
		return this.connectTo(() => relay.transport());
	}
	newTab() {
		this.tab = this.tab + 1;
	}
	resetVideoStartEmitted() {
		this.videoStartEmitted = false;
	}
	async captureFailureScreenshot(event: string, step?: TStepResult) {
		try {
			return await this.captureScreenshotAndLog(event, { step });
		} catch (e) {
			this.getWorld().eventLogger.debug(`captureFailureScreenshot error ${e}`);
		}
	}

	async captureScreenshotAndLog(event: string, details: { seq?: number; step?: TStepResult }): Promise<TImageReference> {
		const { image, savedTo } = await this.captureScreenshot(event, details);
		this.getWorld().eventLogger.debug(`${event} screenshot to ${pathToFileURL(savedTo)}`);
		return image;
	}

	/** Screenshot the page into the run's storage, as an image artifact, and return the address the run serves it at and
	 *  where it was saved. */
	async captureScreenshot(event: string, details: { seq?: number; step?: TStepResult }): Promise<{ image: TImageReference; savedTo: string }> {
		const { step } = details;
		if (!step) throw new Error(`a ${event} screenshot is saved with the step it shows, and none is named`);
		const filename = `event-${step.seqPath.join(".")}.png`;
		const buffer = await this.withPage(async (page) => await page.screenshot());
		const saved = await saveImageArtifact(this.getWorld(), this.storage, { seqPath: step.seqPath, in: step.in, source: { path: step.path } }, filename, buffer, SCREENSHOT_FORMAT);
		return { image: { contentUrl: artifactAddress(saved.baseRelativePath), encodingFormat: SCREENSHOT_FORMAT }, savedTo: saved.absolutePath };
	}

	async setExtraHTTPHeaders(headers: { [name: string]: string }) {
		await this.withPage(async (page) => {
			await page.context().setExtraHTTPHeaders(headers);
			this.extraHTTPHeaders = headers;
		});
	}

	async withPageFetch(endpoint: string, method = "get", requestOptions: TRequestOptions = {}): Promise<TCapturedResponse> {
		const { headers, postData, userAgent } = requestOptions;
		const ua = userAgent || this.apiUserAgent;
		const page = await this.getPage();
		// FIXME Part I this could suffer from race conditions
		if (ua) await page.context().setExtraHTTPHeaders({ ...this.extraHTTPHeaders, "User-Agent": ua });
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
						// A body is read once, as its text, and read again as JSON where it is JSON.
						const text = await response.text();
						let json: TJsonResponse | undefined;
						try {
							json = JSON.parse(text) as TJsonResponse;
						} catch {
							// A body that isn't JSON is its text alone.
						}
						const capturedResponse: TCapturedResponse = {
							status: response.status,
							statusText: response.statusText,
							headers: Object.fromEntries(response.headers.entries()),
							url: response.url,
							text,
							...(json === undefined ? {} : { json }),
						};

						return capturedResponse;
					},
					{ endpoint, method, headers, postData },
				);

				return ret;
			} catch (e) {
				const msg = errorDetail(e);
				throw new Error(
					`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${msg}. Page console messages: ${pageConsoleMessages.map((msg) => `[${msg.type}] ${msg.text}`).join("; ")}`,
				);
			}
		} catch (e) {
			const ua = userAgent || this.apiUserAgent;
			const msg = errorDetail(e);
			throw new Error(`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${msg}`);
		} finally {
			// FIXME Part II this could suffer from race conditions
			if (ua) await page.context().setExtraHTTPHeaders(this.extraHTTPHeaders);
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
		this.twinPage = await TwinPage.create(this, this.storage, this.headless);
	}

	/** The response a step captured last, where one did. */
	async getLastResponse(): Promise<TCapturedResponse | undefined> {
		const resolved = await this.getWorld().shared.resolveVariable({ term: LAST_REST_RESPONSE, origin: Origin.var }, undefined, undefined, { secure: true });
		return resolved.value === undefined ? undefined : fromJsonText(CapturedResponseSchema).parse(resolved.value);
	}
	async setLastResponse(serialized: TCapturedResponse, featureStep: TFeatureStep) {
		await this.getWorld().shared.setJSON(LAST_REST_RESPONSE, serialized, Origin.var, featureStep);
	}
	/** Returns the Playwright locator for a page target, from the `getBy` method its locator domain selects. */
	locateByDomain(page: TPageScope, target: TStepValue): Locator {
		const strValue = String(target.value);
		switch (locatorDomainOf(target)) {
			case DOMAIN_STRING:
			case DOMAIN_PAGE_TEXT:
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

/** The locator domain of a page target: its own domain when that is a single locator domain, and page text for a literal,
 *  whose domain is the whole page-target union. */
export const locatorDomainOf = (target: TStepValue): string => {
	const parts = domainParts(target.domain);
	return parts.length === 1 ? itemAt(parts, 0) : pickLocatorDomain(parts);
};

/** Selects the locator domain for a value whose domain is a union of locator domains: page text where the union contains
 *  it, since a literal is text the page shows, and otherwise the first specific locator domain the union contains. */
export function pickLocatorDomain(parts: string[]): string {
	if (parts.includes(DOMAIN_PAGE_TEXT)) return DOMAIN_PAGE_TEXT;
	// Then try specific locator domains
	const locatorDomains = [DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LABEL, DOMAIN_PAGE_PLACEHOLDER, DOMAIN_PAGE_ROLE, DOMAIN_PAGE_TITLE, DOMAIN_PAGE_ALT_TEXT, DOMAIN_PAGE_LOCATOR];
	for (const d of locatorDomains) {
		if (parts.includes(d)) return d;
	}
	return itemAt(parts, 0);
}

export default WebPlaywright;

type TLoadedExtension = { id: string; origin: string; worker: boolean; sidePanel: boolean };

/** The side panel an extension's toolbar button opens, read in the extension's worker, the one context its side panel API
 *  is read in. Evaluated there, so it names only what the worker holds. */
async function readSidePanel(): Promise<{ path: string; opensOnAction: boolean }> {
	type TSidePanel = { getOptions(of: object): Promise<{ path?: string }>; getPanelBehavior(): Promise<{ openPanelOnActionClick?: boolean }> };
	const { sidePanel } = (globalThis as unknown as { chrome: { sidePanel: TSidePanel } }).chrome;
	const [options, behavior] = await Promise.all([sidePanel.getOptions({}), sidePanel.getPanelBehavior()]);
	return { path: options.path ?? "", opensOnAction: behavior.openPanelOnActionClick === true };
}

/** An extension's id, as Chromium derives it from the public key its manifest pins: the first 32 hex digits of the key's
 *  SHA-256, each written as a letter from a to p. */
function extensionIdOf(key: string): string {
	const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
	return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}
