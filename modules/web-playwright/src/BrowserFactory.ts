import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices } from 'playwright';

import { ILogger } from '@haibun/core/build/lib/interfaces/logger.js';
import { TTag, TTagValue } from '@haibun/core/build/lib/defs.js';
import { PlaywrightEvents } from './PlaywrightEvents.js';

export const BROWSERS: { [name: string]: BrowserType } = {
	firefox,
	chromium,
	webkit,
};
export type TBrowserTypes = 'firefox' | 'chromium' | 'webkit';

export type TBrowserFactoryOptions = {
	browser: {
		headless: boolean;
		devtools?: boolean;
		args?: string[];
	};
	recordVideo?: {
		dir: string;
		size: { width: 640; height: 480 };
	};
	defaultTimeout?: number;
	persistentDirectory?: boolean;
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
	static tracer?: PlaywrightEvents = undefined;
	static configs: {
		[name: string]: {
			options: TBrowserFactoryOptions;
			browserType: BrowserType;
		};
	} = {};
	static persistentDirectory = undefined;

	private constructor(private logger: ILogger) {}

	static async getBrowserFactory(logger: ILogger, options: TBrowserFactoryOptions, tag = DEFAULT_CONFIG_TAG) {
		options.type = options.type || 'chromium';
		options.device = options.device || '';

		if (!BROWSERS[options.type]) {
			throw Error(`browserType not recognized ${options.type}`);
		}
		BrowserFactory.configs[tag] = { options, browserType: BROWSERS[options.type] };
		return new BrowserFactory(logger);
	}

	async getBrowser(type: string, tag = DEFAULT_CONFIG_TAG): Promise<Browser> {
		if (!BrowserFactory.browsers[type]) {
			BrowserFactory.browsers[type] = await BrowserFactory.configs[tag].browserType.launch(
				BrowserFactory.configs[tag].options.browser
			);
			this.logger.debug(`launched new ${type} browser`);
		}
		return BrowserFactory.browsers[type];
	}

	getExistingBrowserContext({ sequence }: { sequence: TTagValue }) {
		if (this.browserContexts[sequence]) {
			return this.browserContexts[sequence];
		}
	}

	private async getBrowserContext(sequence: TTagValue, tag = DEFAULT_CONFIG_TAG): Promise<BrowserContext> {
		if (!this.browserContexts[sequence]) {
			let browserContext: BrowserContext;
			if (BrowserFactory.configs.persistentDirectory) {
				this.logger.debug(
					`creating new persistent context ${sequence} ${BrowserFactory.configs[tag].options.type}, ${
						BrowserFactory.configs.persistentDirectory
					} with ${JSON.stringify(BrowserFactory.configs)}`
				);
				browserContext = await BrowserFactory.configs[tag].browserType.launchPersistentContext(
					'',
					BrowserFactory.configs[tag].options
				);
			} else {
				this.logger.debug(`creating new context ${sequence} ${BrowserFactory.configs[tag].options.type}`);
				const browser = await this.getBrowser(BrowserFactory.configs[tag].options.type);
				const deviceContext = BrowserFactory.configs[tag].options.device
					? { ...devices[BrowserFactory.configs[tag].options.device] }
					: {};
				browserContext = await browser.newContext({ ...deviceContext, ...BrowserFactory.configs[tag].options });
			}
			this.browserContexts[sequence] = browserContext;
			if (BrowserFactory.configs.defaultTimeout) {
				this.browserContexts[sequence].setDefaultTimeout(BrowserFactory.configs[tag].options.defaultTimeout);
			}
		}
		return this.browserContexts[sequence];
	}

	async closeContext({ sequence }: { sequence: TTagValue }) {
		if (this.browserContexts[sequence] !== undefined) {
			const p = this.pages[sequence];
			(await p) && p?.close();
		}
		await this.browserContexts[sequence]?.close();
		this.tracers[sequence]?.close();
		delete this.pages[sequence];
		delete this.browserContexts[sequence];
	}

	static async closeBrowsers() {
		for (const b in BrowserFactory.browsers) {
			await BrowserFactory.browsers[b].close();
		}
	}
	async close() {
		await BrowserFactory.closeBrowsers();
	}

	pageKey(sequence: number, tab?: number) {
		return `${sequence}-${tab}`;
	}

	hasPage({ sequence }: { sequence: TTagValue }, tab?: number) {
		return !!this.pages[this.pageKey(sequence, tab)];
	}

	registerPopup({ sequence }: { sequence: TTagValue }, tab: number, popup: Page) {
		const tt = this.pageKey(sequence, tab);
		this.pages[tt] = popup;
	}

	async getBrowserContextPage(tag: TTag, tab: number): Promise<Page> {
		const { sequence } = tag;
		const pageKey = this.pageKey(sequence, tab);
		let page = this.pages[pageKey];
		if (page) {
			await page.bringToFront();
			return page;
		}
		this.logger.debug(`creating new page for ${sequence}`);

		const context = await this.getBrowserContext(sequence);
		page = await context.newPage();
		const tracer = new PlaywrightEvents(this.logger, page, tag);

		this.pages[pageKey] = page;
		this.tracers[sequence] = tracer;
		return page;
	}
}
