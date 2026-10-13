/**
 * Actuality's browser, its contexts and its pages, obtained by launching a browser or by connecting to a running one.
 * Each context and page is a holding: actuality closes, traces, binds errors to and handles dialogs on only what it
 * opened, and a connected browser's own context and the page tab 0 adopts from it stay its owner's.
 */
import { chromium, devices, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type LaunchOptions, type Page } from "playwright";
import type { TBrowserLog, TBrowserOptions, TBrowserPages, THolding, TPageObserver } from "../ports.js";
import { observePage } from "./page-events.js";

/** The browsers actuality launches, by name. */
const BROWSERS: Record<TBrowserOptions["browserType"], BrowserType> = { firefox, chromium, webkit };
/** The viewport of a context that doesn't emulate a device. */
const VIEWPORT = { width: 1280, height: 1024 };
/** The tab whose page a connected browser's owner holds open. */
const ADOPTED_TAB = 0;

/** A connected browser by name: the one at its endpoint, or the one attached through the relay. */
const cdpName = (cdp: NonNullable<TBrowserOptions["cdp"]>): string => (typeof cdp === "string" ? `the browser at ${cdp}` : "the attached browser");
/** The name a browser is held by: the browser it connects to, or the type it launches. */
const browserKey = ({ cdp, browserType }: TBrowserOptions): string => (cdp === undefined ? browserType : cdpName(cdp));
const pageKey = (featureNum: number, tab: number) => `${featureNum}-${tab}`;

/** What a factory makes beside the browser: a holding for each context and page, and the observer of each page actuality opens. */
export type TFactoryMakes = { holding: () => THolding; observer: (pageKey: string) => TPageObserver; log: TBrowserLog };

export class BrowserFactory implements TBrowserPages {
	/** The browsers of every factory, by name, so a feature's factory reuses the browser an earlier one obtained. */
	static readonly #browsers = new Map<string, Browser>();
	readonly #contexts = new Map<number, { context: BrowserContext; holding: THolding }>();
	readonly #pages = new Map<string, { page: Page; holding: THolding; stopObserving?: () => void }>();
	readonly #options: TBrowserOptions;
	readonly #makes: TFactoryMakes;

	constructor(options: TBrowserOptions, makes: TFactoryMakes) {
		this.#options = options;
		this.#makes = makes;
	}

	/** Closes every browser any factory obtained. */
	static async closeBrowsers(): Promise<void> {
		for (const [name, browser] of BrowserFactory.#browsers) {
			await browser.close();
			BrowserFactory.#browsers.delete(name);
		}
	}

	/** The browser: the one held by its name, or the one this factory connects to or launches. */
	async browser(): Promise<Browser> {
		const key = browserKey(this.#options);
		const held = BrowserFactory.#browsers.get(key);
		if (held) return held;
		const { cdp, options, launchOptions } = this.#options;
		const launch: LaunchOptions = { ...options, ...launchOptions };
		const browser =
			cdp === undefined
				? await BROWSERS[this.#options.browserType].launch(launch)
				: typeof cdp === "string"
					? await chromium.connectOverCDP(cdp)
					: await chromium.connectOverCDP(cdp());
		browser.on("disconnected", () => {
			BrowserFactory.#browsers.delete(key);
			this.#drop();
		});
		BrowserFactory.#browsers.set(key, browser);
		return browser;
	}

	hasPage(featureNum: number, tab: number): boolean {
		return this.#pages.has(pageKey(featureNum, tab));
	}

	registerPopup(featureNum: number, tab: number, popup: Page): void {
		const holding = this.#makes.holding();
		holding.opened();
		this.#hold(pageKey(featureNum, tab), popup, holding);
	}

	isAdopted(page: Page): boolean {
		const held = [...this.#pages.values()].find((entry) => entry.page === page);
		return held !== undefined && !held.holding.owned();
	}

	context(featureNum: number): BrowserContext | undefined {
		return this.#contexts.get(featureNum)?.context;
	}

	/** The tab's page: the one held, or a new one in the feature's context. Tab 0 of a connected browser is the page its owner holds open. */
	async page(featureNum: number, tab: number): Promise<Page> {
		const key = pageKey(featureNum, tab);
		const held = this.#pages.get(key);
		if (held) return held.page;
		this.#makes.log.debug(`creating new page for ${featureNum}`);
		const context = await this.#context(featureNum);
		const holding = this.#makes.holding();
		if (!context.holding.owned() && tab === ADOPTED_TAB) {
			const page = adoptPage(context.context);
			holding.adopted();
			this.#hold(key, page, holding);
			return page;
		}
		const page = await context.context.newPage();
		holding.opened();
		this.#hold(key, page, holding, observePage(page, this.#makes.observer(key)));
		return page;
	}

	async closeContext(featureNum: number): Promise<void> {
		this.#makes.log.debug(`closed browser context ${featureNum}`);
		const prefix = `${featureNum}-`;
		for (const [key, { page, holding, stopObserving }] of this.#pages) {
			if (!key.startsWith(prefix)) continue;
			if (holding.owned()) await page.close().catch((error: unknown) => this.#makes.log.error(`closing the page of tab ${key} failed: ${String(error)}`));
			stopObserving?.();
			holding.closed();
			this.#pages.delete(key);
		}
		const held = this.#contexts.get(featureNum);
		if (held === undefined) return;
		if (held.holding.owned()) await held.context.close();
		held.holding.closed();
		this.#contexts.delete(featureNum);
	}

	/** Lets go of the browser this factory connects to, leaving it running: its pages and contexts are dropped as its
	 *  disconnection drops them, and the next page actuality opens connects again. */
	async disconnect(): Promise<void> {
		if (this.#options.cdp === undefined) throw new Error("actuality launched this browser, so it closes the browser rather than disconnecting from it");
		await BrowserFactory.#browsers.get(browserKey(this.#options))?.close();
	}

	async close(): Promise<void> {
		await BrowserFactory.closeBrowsers();
	}

	#hold(key: string, page: Page, holding: THolding, stopObserving?: () => void): void {
		page.on("close", () => {
			holding.closed();
			this.#pages.delete(key);
		});
		this.#pages.set(key, { page, holding, ...(stopObserving === undefined ? {} : { stopObserving }) });
	}

	/** Every page and context closed, as a browser's disconnection closes them. */
	#drop(): void {
		for (const { holding, stopObserving } of this.#pages.values()) {
			stopObserving?.();
			holding.closed();
		}
		for (const { holding } of this.#contexts.values()) holding.closed();
		this.#pages.clear();
		this.#contexts.clear();
	}

	/** The feature's context: a connected browser's own, adopted; a persistent one where a profile is kept; or a new one. */
	async #context(featureNum: number): Promise<{ context: BrowserContext; holding: THolding }> {
		const held = this.#contexts.get(featureNum);
		if (held) return held;
		const { cdp, device, options, launchOptions, persistentDirectory, browserType, defaultTimeout } = this.#options;
		const deviceContext = device === undefined ? { viewport: VIEWPORT } : { ...devices[device] };
		const contextOptions = { ...deviceContext, ...options, ...launchOptions };
		const holding = this.#makes.holding();
		let context: BrowserContext;
		if (cdp !== undefined) {
			const [own] = (await this.browser()).contexts();
			if (!own) throw new Error(`${cdpName(cdp)} doesn't have a context to adopt`);
			context = own;
			holding.adopted();
		} else if (persistentDirectory !== undefined) {
			this.#makes.log.debug(`creating new persistent context ${featureNum} ${browserType}, ${persistentDirectory}`);
			context = await BROWSERS[browserType].launchPersistentContext(persistentDirectory, contextOptions);
			holding.opened();
		} else {
			this.#makes.log.debug(`creating new context ${featureNum} ${browserType}`);
			context = await (await this.browser()).newContext(contextOptions);
			holding.opened();
		}
		// A feature without a timeout of its own keeps Playwright's.
		if (defaultTimeout !== undefined) context.setDefaultTimeout(defaultTimeout);
		const entry = { context, holding };
		this.#contexts.set(featureNum, entry);
		return entry;
	}
}

/** Tab 0 of a connected browser: the one page its owner holds open in the context actuality adopted. */
function adoptPage(context: BrowserContext): Page {
	const pages = context.pages();
	const [page] = pages;
	if (!page || pages.length !== 1) throw new Error(`tab 0 adopts the one page of the connected browser's context, which holds ${pages.length}`);
	// Playwright dismisses a dialog only where the page lacks a dialog listener, so a listener that leaves it open leaves it to the owner.
	page.on("dialog", () => undefined);
	return page;
}
