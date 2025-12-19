import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, BrowserContextOptions, LaunchOptions } from 'playwright';

import { PlaywrightEvents } from './PlaywrightEvents.js';
import { TWorld } from '@haibun/core/lib/defs.js';
import { Timer } from '@haibun/core/schema/protocol.js';
import { TTagValue, TTag } from '@haibun/core/lib/ttag.js';

export const BROWSERS: { [name: string]: BrowserType } = {
	firefox,
	chromium,
	webkit,
};
export type TBrowserTypes = 'firefox' | 'chromium' | 'webkit';

export type TTaggedBrowserFactoryOptions = {
	options: BrowserContextOptions;
	persistentDirectory?: string;
	browserType: BrowserType;
	launchOptions: {
		headless?: boolean;
		devtools?: boolean;
		args?: string[];
	};
	defaultTimeout?: number;
	type?: TBrowserTypes;
	device?: string;
};

export const DEFAULT_CONFIG_TAG = '_default';

export type PageInstance = Page & { _guid: string };

export class BrowserFactory {
	static browsers: { [name: string]: Browser } = {};
	tracers: { [name: string]: PlaywrightEvents } = {};
	browserContexts: { [name: string]: BrowserContext } = {};
	pages: { [name: string]: Page | undefined } = {};
	contextStats: { [featureNum: string]: { start: number, end?: number, duration?: number } } = {};
	static tracer?: PlaywrightEvents = undefined;
	static configs: { [name: string]: TTaggedBrowserFactoryOptions } = {};

	private constructor(private world: TWorld) { }

	static getBrowserFactory(world: TWorld, tagConfig: TTaggedBrowserFactoryOptions, tag = DEFAULT_CONFIG_TAG) {
		BrowserFactory.configs[tag] = tagConfig;
		return new BrowserFactory(world);
	}

	public async getBrowser(type: string, tag = DEFAULT_CONFIG_TAG): Promise<Browser> {
		const config = BrowserFactory.configs[tag];

		const browserOptions: LaunchOptions = { ...config.options, ...config.launchOptions }
		if (!BrowserFactory.browsers[type]) {
			BrowserFactory.browsers[type] = await config.browserType.launch(browserOptions);
			const browser = BrowserFactory.browsers[type];

			return browser;
		}
	}

	public getExistingBrowserContextWithTag({ featureNum }: { featureNum: number }) {
		if (this.browserContexts[featureNum]) {
			return this.browserContexts[featureNum];
		}
	}

	public async closeContext({ featureNum }: { featureNum: number }) {
		this.world.eventLogger.debug(`closed browser context ${featureNum}`);
		if (this.browserContexts[featureNum] !== undefined) {
			const p = this.pages[featureNum];
			if (p) {
				try {
					await p.close();
				} catch (error) {
					this.world.eventLogger.error(`Error closing page: ${error}`);
				}
			}
		}
		await this.browserContexts[featureNum]?.close();
		this.captureVideoStart(featureNum);
		this.tracers[featureNum]?.close();
		delete this.pages[featureNum];
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
		page = await context.newPage();

		const tracer = await (new PlaywrightEvents(this.world, page, tag)).init();

		this.pages[pageKey] = page;
		this.tracers[featureNum] = tracer;
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
						height: 1024
					},
				};
			const launchConfig = { ...deviceContext, ...config.options, ...config.launchOptions }
			if (config.persistentDirectory) {
				this.world.eventLogger.debug(
					`creating new persistent context ${featureNum} ${config.type}, ${config.persistentDirectory
					} with ${JSON.stringify(BrowserFactory.configs)}`
				);
				browserContext = await BrowserFactory.configs[tag].browserType.launchPersistentContext(
					config.persistentDirectory,
					launchConfig
				);
			} else {
				this.world.eventLogger.debug(`creating new context ${featureNum} ${config.type}`);
				const browser = await this.getBrowser(config.type);
				browserContext = await browser.newContext(launchConfig);
			}
			this.browserContexts[featureNum] = browserContext;
			this.contextStats[featureNum] = { start: Timer.since() };
			if (BrowserFactory.configs.defaultTimeout) {
				this.browserContexts[featureNum].setDefaultTimeout(config.defaultTimeout);
			}
		}
		return this.browserContexts[featureNum];
	}
}
