import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, BrowserContextOptions, LaunchOptions, type ConnectOverCDPTransport } from "playwright";

import { PlaywrightEvents } from "./PlaywrightEvents.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { Timer } from "@haibun/core/schema/protocol.js";
import { TTag } from "@haibun/core/lib/ttag.js";

export const BROWSERS: { [name: string]: BrowserType } = {
	firefox,
	chromium,
	webkit,
};
export type TBrowserTypes = "firefox" | "chromium" | "webkit";

export type TTaggedBrowserFactoryOptions = {
	options: BrowserContextOptions;
	/** The profile a persistent context keeps, where the run keeps one; empty for one Playwright makes for the browser and
	 *  removes when it closes. */
	persistentDirectory?: string;
	browserType: BrowserType;
	launchOptions: {
		headless?: boolean;
		devtools?: boolean;
		args?: string[];
		/** The browser distribution to launch, as Playwright names it, where not its default. */
		channel?: string;
	};
	defaultTimeout?: number;
	type?: TBrowserTypes;
	device?: string;
	/** A running browser the factory connects to instead of launching one: its CDP endpoint, or the transport Playwright
	 *  drives it through in this process, made at the moment of connecting. */
	cdp?: string | (() => ConnectOverCDPTransport);
};

export const DEFAULT_CONFIG_TAG = "_default";

/** A connected browser as a run names it: the one at its endpoint, or the one attached through the relay. */
const cdpName = (cdp: string | (() => ConnectOverCDPTransport)): string => (typeof cdp === "string" ? `the browser at ${cdp}` : "the attached browser");

export type PageInstance = Page & { _guid: string };

/**
 * Obtains the run's browser, its contexts and its pages, by launching a browser or by connecting to a running one.
 * The run closes, traces, binds errors to and answers dialogs on only what it opened: a connected browser's own
 * context and the page tab 0 adopts from it belong to whoever runs that browser.
 */
export class BrowserFactory {
	static browsers: { [name: string]: Browser } = {};
	tracers: { [pageKey: string]: PlaywrightEvents } = {};
	browserContexts: { [name: string]: BrowserContext } = {};
	pages: { [name: string]: Page | undefined } = {};
	contextStats: { [featureNum: string]: { start: number; end?: number; duration?: number } } = {};
	static configs: { [name: string]: TTaggedBrowserFactoryOptions } = {};
	private adoptedContexts = new WeakSet<BrowserContext>();
	private adoptedPages = new WeakSet<Page>();

	private constructor(private world: TWorld) {}

	static getBrowserFactory(world: TWorld, tagConfig: TTaggedBrowserFactoryOptions, tag = DEFAULT_CONFIG_TAG) {
		BrowserFactory.configs[tag] = tagConfig;
		return new BrowserFactory(world);
	}

	public async getBrowser(type: string, tag = DEFAULT_CONFIG_TAG): Promise<Browser> {
		const config = BrowserFactory.configs[tag];
		const key = config.cdp === undefined ? type : cdpName(config.cdp);
		if (!BrowserFactory.browsers[key]) {
			const browserOptions: LaunchOptions = { ...config.options, ...config.launchOptions };
			const browser =
				config.cdp === undefined
					? await config.browserType.launch(browserOptions)
					: typeof config.cdp === "string"
						? await chromium.connectOverCDP(config.cdp)
						: await chromium.connectOverCDP(config.cdp());
			browser.on("disconnected", () => {
				delete BrowserFactory.browsers[key];
				this.browserContexts = {};
				this.pages = {};
				this.tracers = {};
			});
			BrowserFactory.browsers[key] = browser;
		}
		return BrowserFactory.browsers[key];
	}

	public getExistingBrowserContextWithTag({ featureNum }: { featureNum: number }) {
		if (this.browserContexts[featureNum]) {
			return this.browserContexts[featureNum];
		}
	}

	/** Whether the page belongs to the connected browser's owner rather than to the run. */
	public isAdopted(page: Page) {
		return this.adoptedPages.has(page);
	}

	public async closeContext({ featureNum }: { featureNum: number }) {
		this.world.eventLogger.debug(`closed browser context ${featureNum}`);
		const prefix = `${featureNum}-`;
		for (const [key, page] of Object.entries(this.pages)) {
			if (!key.startsWith(prefix)) continue;
			if (page && !this.adoptedPages.has(page)) {
				try {
					await page.close();
				} catch (error) {
					this.world.eventLogger.error(`Error closing page: ${error}`);
				}
			}
			this.tracers[key]?.close();
			delete this.tracers[key];
			delete this.pages[key];
		}
		const context = this.browserContexts[featureNum];
		if (context && !this.adoptedContexts.has(context)) await context.close();
		this.captureVideoStart(featureNum);
		delete this.browserContexts[featureNum];
	}

	private captureVideoStart(featureNum: number) {
		if (!this.contextStats[featureNum]) {
			return;
		}
		this.contextStats[featureNum].end = Timer.since();
		this.contextStats[featureNum].duration = this.contextStats[featureNum].end - this.contextStats[featureNum].start;
		this.world.eventLogger.debug(`video stats for ${featureNum}: duration ${this.contextStats[featureNum].duration}`);
	}

	static async closeBrowsers() {
		for (const b in BrowserFactory.browsers) {
			await BrowserFactory.browsers[b].close();
			delete BrowserFactory.browsers[b];
		}
	}
	async close() {
		await BrowserFactory.closeBrowsers();
	}

	public hasPage({ featureNum }: { featureNum: number }, tab?: number) {
		return !!this.pages[this.pageKey(featureNum, tab)];
	}

	public registerPopup({ featureNum }: { featureNum: number }, tab: number, popup: Page) {
		const tt = this.pageKey(featureNum, tab);
		this.pages[tt] = popup;
	}

	public async getBrowserContextPage(tag: TTag, tab: number): Promise<Page> {
		const { featureNum } = tag;
		const pageKey = this.pageKey(featureNum, tab);
		let page = this.pages[pageKey];
		if (page) {
			// await page.bringToFront();
			return page;
		}
		this.world.eventLogger.debug(`creating new page for ${featureNum}`);

		const context = await this.getBrowserContextWithFeatureNum(featureNum);
		if (this.adoptedContexts.has(context) && tab === 0) {
			page = this.adoptPage(context);
		} else {
			page = await context.newPage();
			this.tracers[pageKey] = new PlaywrightEvents(this.world, page, tag, pageKey).init();
		}
		page.on("close", () => delete this.pages[pageKey]);
		this.pages[pageKey] = page;
		return page;
	}

	/** Tab 0 of a connected browser is the one page its owner holds open in the context the run adopted. */
	private adoptPage(context: BrowserContext): Page {
		const pages = context.pages();
		if (pages.length !== 1) throw Error(`tab 0 adopts the one page of the connected browser's context, which holds ${pages.length}`);
		const [page] = pages;
		this.adoptedPages.add(page);
		// Playwright dismisses a dialog only when nothing listens for it, so a listener that doesn't answer leaves it to the owner.
		page.on("dialog", () => undefined);
		return page;
	}

	private pageKey(featureNum: number, tab?: number) {
		return `${featureNum}-${tab}`;
	}

	private async getBrowserContextWithFeatureNum(featureNum: number, tag = DEFAULT_CONFIG_TAG): Promise<BrowserContext> {
		if (!this.browserContexts[featureNum]) {
			let browserContext: BrowserContext;
			const config = BrowserFactory.configs[tag];
			const deviceContext = config.device
				? { ...devices[config.device] }
				: {
						viewport: {
							width: 1280,
							height: 1024,
						},
					};
			const launchConfig = { ...deviceContext, ...config.options, ...config.launchOptions };
			if (config.cdp !== undefined) {
				const [context] = (await this.getBrowser(config.type, tag)).contexts();
				if (!context) throw Error(`${cdpName(config.cdp)} has no context to adopt`);
				this.adoptedContexts.add(context);
				browserContext = context;
			} else if (config.persistentDirectory !== undefined) {
				this.world.eventLogger.debug(`creating new persistent context ${featureNum} ${config.type}, ${config.persistentDirectory} with ${JSON.stringify(BrowserFactory.configs)}`);
				browserContext = await BrowserFactory.configs[tag].browserType.launchPersistentContext(config.persistentDirectory, launchConfig);
			} else {
				this.world.eventLogger.debug(`creating new context ${featureNum} ${config.type}`);
				const browser = await this.getBrowser(config.type);
				browserContext = await browser.newContext(launchConfig);
			}
			this.browserContexts[featureNum] = browserContext;
			this.contextStats[featureNum] = { start: Timer.since() };
			if (config.defaultTimeout) {
				this.browserContexts[featureNum].setDefaultTimeout(config.defaultTimeout);
			}
		}
		return this.browserContexts[featureNum];
	}
}
