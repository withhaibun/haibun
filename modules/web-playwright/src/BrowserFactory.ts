import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, BrowserContextOptions, LaunchOptions } from 'playwright';

import { TMessageContext, TArtifactVideoStart, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js'; // Updated imports
import { TTag, TTagValue, TWorld } from '@haibun/core/build/lib/defs.js';
import { PlaywrightEvents } from './PlaywrightEvents.js';

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
	static tracer?: PlaywrightEvents = undefined;
	static configs: { [name: string]: TTaggedBrowserFactoryOptions } = {};

	private constructor(private world: TWorld) { }

	static async getBrowserFactory(world: TWorld, tagConfig: TTaggedBrowserFactoryOptions, tag = DEFAULT_CONFIG_TAG) {
		BrowserFactory.configs[tag] = tagConfig;
		return Promise.resolve(new BrowserFactory(world));
	}

	public async getBrowser(type: string, tag = DEFAULT_CONFIG_TAG): Promise<Browser> {
		const config = BrowserFactory.configs[tag];

		const browserOptions: LaunchOptions = { ...config.options, ...config.launchOptions }
		if (!BrowserFactory.browsers[type]) {
			BrowserFactory.browsers[type] = await config.browserType.launch(browserOptions);

			// Create context using the new structure
			const vs: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Assuming ACTION is appropriate here
				artifact: <TArtifactVideoStart>{
					start: this.world.timer.since(),
					artifactType: 'video/start'
				},
				tag: this.world.tag // Add the tag
			};
			this.world.logger.debug(`launched new ${type} browser`, vs);
		}
		return BrowserFactory.browsers[type];
	}

	public getExistingBrowserContextWithTag({ sequence }: { sequence: TTagValue }) {
		if (this.browserContexts[sequence]) {
			return this.browserContexts[sequence];
		}
	}


	public async closeContext({ sequence }: { sequence: TTagValue }) {
		if (this.browserContexts[sequence] !== undefined) {
			const p = this.pages[sequence];
			if (p) {
				try {
					await p.close();
				} catch (error) {
					this.world.logger.error(`Error closing page: ${error}`);
				}
			}
		}
		await this.browserContexts[sequence]?.close();
		this.tracers[sequence]?.close();
		delete this.pages[sequence];
		delete this.browserContexts[sequence];
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

	public hasPage({ sequence }: { sequence: TTagValue }, tab?: number) {
		return !!this.pages[this.pageKey(sequence, tab)];
	}

	public registerPopup({ sequence }: { sequence: TTagValue }, tab: number, popup: Page) {
		const tt = this.pageKey(sequence, tab);
		this.pages[tt] = popup;
	}

	public async getBrowserContextPage(tag: TTag, tab: number): Promise<Page> {
		const { sequence } = tag;
		const pageKey = this.pageKey(sequence, tab);
		let page = this.pages[pageKey];
		if (page) {
			// await page.bringToFront();
			return page;
		}
		this.world.logger.debug(`creating new page for ${sequence}`);

		const context = await this.getBrowserContextWithSequence(sequence);
		page = await context.newPage();

		const tracer = new PlaywrightEvents(this.world.logger, page, tag);

		this.pages[pageKey] = page;
		this.tracers[sequence] = tracer;
		return page;
	}

	private pageKey(sequence: number, tab?: number) {
		return `${sequence}-${tab}`;
	}

	private async getBrowserContextWithSequence(sequence: TTagValue, tag = DEFAULT_CONFIG_TAG): Promise<BrowserContext> {
		if (!this.browserContexts[sequence]) {
			let browserContext: BrowserContext;
			const config = BrowserFactory.configs[tag];
			const deviceContext = config.device
				? { ...devices[config.device] }
				: {
					viewport: {
						width: 800,
						height: 600
					},
				};
			const launchConfig = { ...deviceContext, ...config.options, ...config.launchOptions }
			if (config.persistentDirectory) {
				this.world.logger.debug(
					`creating new persistent context ${sequence} ${config.type}, ${config.persistentDirectory
					} with ${JSON.stringify(BrowserFactory.configs)}`
				);
				browserContext = await BrowserFactory.configs[tag].browserType.launchPersistentContext(
					config.persistentDirectory,
					launchConfig
				);
			} else {
				this.world.logger.debug(`creating new context ${sequence} ${config.type}`);
				const browser = await this.getBrowser(config.type);
				browserContext = await browser.newContext(launchConfig);
			}
			this.browserContexts[sequence] = browserContext;
			if (BrowserFactory.configs.defaultTimeout) {
				this.browserContexts[sequence].setDefaultTimeout(config.defaultTimeout);
			}
		}
		return this.browserContexts[sequence];
	}
}
