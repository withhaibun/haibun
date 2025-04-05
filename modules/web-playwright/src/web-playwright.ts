import { Page, Response, Download } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { IHasOptions, OK, TNamed, TStepResult, AStepper, TWorld, TFeatureStep, TAnyFixme, IStepperCycles, TEndFeature } from '@haibun/core/build/lib/defs.js';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/core/build/lib/domain-types.js';
import { BrowserFactory, TTaggedBrowserFactoryOptions, TBrowserTypes, BROWSERS } from './BrowserFactory.js';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption, sleep, optionOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EExecutionMessageType, TArtifactImage, TArtifactVideo, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js'; // Removed TArtifactMessageContext, added TMessageContext
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

import { restSteps, TCapturedResponse } from './rest-playwright.js';
import { createMonitorPageAndSubscriber, writeMonitor } from './monitor/monitorHandler.js';

export enum EMonitoringTypes {
	MONITOR_ALL = 'all',
	MONITOR_EACH = 'each',
}

type TRequestOptions = {
	headers?: Record<string, string>;
	postData?: string | URLSearchParams | FormData | Blob | ArrayBuffer | ArrayBufferView;
	userAgent?: string
};

const cycles = (wp: WebPlaywright): IStepperCycles => ({
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async onFailure(result: TStepResult, step?: TFeatureStep): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot('failure', EExecutionMessageType.ON_FAILURE, step);
		}
	},
	async startFeature(): Promise<void> {
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.createMonitor();
		}
	},
	async endFeature({ shouldClose = true }: TEndFeature) {
		// leave web server running if there was a failure and it's the last feature
		if (shouldClose) {
			for (const file of wp.downloaded) {
				wp.getWorld().logger.debug(`removing ${JSON.stringify(file)}`);
				// rmSync(file);
			}
			if (wp.hasFactory) {
				if (wp.captureVideo) {
					const page = await wp.getPage();
					const path = await wp.storage.getRelativePath(await page.video().path());
					const artifact: TArtifactVideo = { artifactType: 'video', path };
					// Log feature video using the new context structure
					const context: TMessageContext = {
						incident: EExecutionMessageType.FEATURE_END, // Use appropriate incident type
						artifact,
						tag: wp.getWorld().tag
					}; // End context object definition
					wp.getWorld().logger.log('feature video', context); // Add the missing log call
				}
				// close the context, which closes any pages
				if (wp.hasFactory) {
					await wp.bf?.closeContext(wp.getWorld().tag);
				}
				await wp.bf?.close();
				wp.bf = undefined;
				wp.hasFactory = false;
			}
		}
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.callClosers();
			await writeMonitor(wp.world, wp.storage, WebPlaywright.monitorPage);
		}
	},
	async startExecution() {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.createMonitor();
		}
	},
	async endExecution() {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.callClosers();
			await writeMonitor(wp.world, wp.storage, WebPlaywright.monitorPage);
		}
	},
});

class WebPlaywright extends AStepper implements IHasOptions {
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
	logElementError: TAnyFixme;
	monitor: EMonitoringTypes;
	static monitorPage: Page;
	userAgentPages: { [name: string]: Page } = {};
	apiUserAgent: string;
	extraHTTPHeaders: { [name: string]: string; } = {};
	BROWSER_STATE_PATH: string = undefined;
	expectedDownload: Promise<Download>;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const args = [...(getStepperOption(this, 'ARGS', world.moduleOptions)?.split(';') || ''),]; //'--disable-gpu'
		this.storage = findStepperFromOption(steppers, this, world.moduleOptions, WebPlaywright.STORAGE);
		const headless = getStepperOption(this, 'HEADLESS', world.moduleOptions) === 'true' || !!process.env.CI;
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
			headless,
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
	async getCaptureDir(type: string) {
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
		const topics = { textContent: { summary: `in ${textContent?.length} characters`, details: textContent } };
		return actionNotOK(`Did not find text "${text}" in ${selector}`, { topics });
	}
	async getCookies() {
		const browserContext = await this.getExistingBrowserContext();
		return await browserContext?.cookies();
	}
	steps = {
		...restSteps(this),
		openDevTools: {
			gwta: `open devtools`,
			action: async () => {
				await this.withPage(async (page: Page) => {
					await page.goto('about:blank');
					await sleep(2000);
					const targetId = await fetch('http://localhost:9223/json/list');
					await page.goto(
						`devtools://devtools/bundled/inspector.html?ws=localhost:9223/devtools/page/${targetId}&panel=network`
					);
				});
				return OK;
			},
		},
		//                                      INPUT

		press: {
			gwta: `press {key}`,
			action: async ({ key }: TNamed) => {
				await this.withPage(async (page: Page) => await page.keyboard.press(key));
				return OK;
			},
		},
		type: {
			gwta: `type {text}`,
			action: async ({ text }: TNamed) => {
				await this.withPage(async (page: Page) => await page.keyboard.type(text));
				return OK;
			},
		},
		inputVariable: {
			gwta: `input {what} for {field}`,
			action: async ({ what, field }: TNamed) => {
				await this.withPage(async (page: Page) => await page.locator(field).fill(what));
				return OK;
			},
		},
		selectionOption: {
			gwta: `select {option} for {field: ${WEB_CONTROL}}`,
			action: async ({ option, field }: TNamed) => {
				await this.withPage(async (page: Page) => await page.selectOption(field, { label: option }));
				// FIXME have to use id value
				return OK;
			},
		},

		//                ASSERTIONS
		dialogIs: {
			gwta: 'dialog {what} {type} says {value}',
			action: async ({ what, type, value }: TNamed) => {
				const cur = this.getWorld().shared.get(what)?.[type];

				return Promise.resolve(cur === value ? OK : actionNotOK(`${what} is ${cur}`));
			},
		},
		dialogIsUnset: {
			gwta: 'dialog {what} {type} not set',
			action: async ({ what, type }: TNamed) => {
				const cur = this.getWorld().shared.get(what)?.[type];
				return Promise.resolve(!cur ? OK : actionNotOK(`${what} is ${cur}`));
			},
		},
		seeTestId: {
			gwta: 'has test id {testId}',
			action: async ({ testId }: TNamed) => {
				const found = await this.withPage(async (page: Page) => await page.getByTestId(testId));
				return found ? OK : actionNotOK(`Did not find test id ${testId}`);
			},
		},
		seeTextIn: {
			gwta: 'in {selector}, see {text}',
			action: async ({ text, selector }: TNamed) => {
				return await this.sees(text, selector);
			},
		},
		seeText: {
			gwta: 'see {text}',
			action: async ({ text }: TNamed) => {
				return await this.sees(text, 'body');
			},
		},
		waitFor: {
			gwta: 'wait for {what}',
			action: async ({ what }: TNamed) => {
				const selector = what.match(/^[.#]/) ? what : `text=${what}`;
				const found = await this.withPage(async (page: Page) => await page.waitForSelector(selector));
				if (found) {
					return OK;
				}
				return actionNotOK(`Did not find ${what}`);
			},
		},

		createMonitor: {
			gwta: 'create monitor',
			action: async () => {
				await this.createMonitor();
				return OK;
			},
		},
		finishMonitor: {
			gwta: 'finish monitor',
			action: async () => {
				await writeMonitor(this.world, this.storage, WebPlaywright.monitorPage);
				return OK;
			},
		},
		onNewPage: {
			gwta: `on a new tab`,
			action: async () => {
				this.newTab();
				return Promise.resolve(OK);
			},
		},
		waitForTabX: {
			gwta: `pause until current tab is {tab}`,
			action: async ({ tab }: TNamed) => {
				const waitForTab = parseInt(tab, 10);
				let timedOut = false;
				setTimeout(() => {
					timedOut = true;
				}, 5000);

				while (this.tab !== waitForTab && !timedOut) {
					await sleep(100);
				}

				return this.tab === waitForTab ? OK : actionNotOK(`current tab is ${this.tab}, not ${waitForTab}`);
			},
		},
		onTabX: {
			gwta: `on tab {tab}`,
			action: async ({ tab }: TNamed) => {
				this.tab = parseInt(tab, 10);
				return Promise.resolve(OK);
			},
		},
		beOnPage: {
			gwta: `be on the {name} ${WEB_PAGE}`,
			action: async ({ name }: TNamed) => {
				const nowon = await this.withPage(async (page: Page) => {
					await page.waitForURL(name);
					return page.url();
				});
				if (nowon === name) {
					return OK;
				}
				return actionNotOK(`expected ${name} but on ${nowon}`);
			},
		},
		extensionContext: {
			gwta: `open extension popup for tab {tab}`,
			action: async ({ tab }: TNamed) => {
				if (!this.factoryOptions?.persistentDirectory || this.factoryOptions?.launchOptions.headless) {
					throw Error(`extensions require ${WebPlaywright.PERSISTENT_DIRECTORY} and not HEADLESS`);
				}
				const browserContext = await this.getExistingBrowserContext();
				if (!browserContext) {
					throw Error(`no browserContext`);
				}

				const background = browserContext?.serviceWorkers()[0];

				if (!background) {
					// background = await context.waitForEvent("serviceworker");
				}

				console.debug('background', background, browserContext.serviceWorkers());

				const extensionId = background.url().split('/')[2];
				this.getWorld().shared.set('extensionContext', extensionId);
				await this.withPage(async (page: Page) => {
					const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
					return await page.goto(popupURI);
				});

				return OK;
			},
		},
		cookieIs: {
			gwta: 'cookie {name} is {value}',
			action: async ({ name, value }: TNamed) => {
				const cookies = await this.getCookies();
				const found = cookies?.find((c) => c.name === name && c.value === value);
				return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
			},
		},
		URIContains: {
			gwta: 'URI includes {what}',
			action: async ({ what }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				return uri.includes(what) ? OK : actionNotOK(`current URI ${uri} does not contain ${what}`);
			},
		},
		URIQueryParameterIs: {
			gwta: 'URI query parameter {what} is {value}',
			action: async ({ what, value }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(what);
				if (found === value) {
					return OK;
				}
				return actionNotOK(`URI query ${what} contains "${found}"", not "${value}""`);
			},
		},
		URIStartsWith: {
			gwta: 'URI starts with {start}',
			action: async ({ start }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				return uri.startsWith(start) ? OK : actionNotOK(`current URI ${uri} does not start with ${start}`);
			},
		},
		URIMatches: {
			gwta: 'URI matches {what}',
			action: async ({ what }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				return uri.match(what) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
			},
		},
		caseInsensitiveURIMatches: {
			gwta: 'URI case insensitively matches {what}',
			action: async ({ what }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				const matcher = new RegExp(what, 'i');
				return uri.match(matcher) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
			},
		},

		//                  CLICK

		clickByAltText: {
			gwta: 'click by alt text {altText}',
			action: async ({ altText }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByAltText(altText).click());
				return OK;
			},
		},
		clickByTestId: {
			gwta: 'click by test id {testId}',
			action: async ({ testId }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByTestId(testId).click());
				return OK;
			},
		},
		clickByPlaceholder: {
			gwta: 'click by placeholder {placeholder}',
			action: async ({ placeholder }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByPlaceholder(placeholder).click());
				return OK;
			},
		},
		clickByRole: {
			gwta: 'click by role {roleStr}',
			action: async ({ roleStr }: TNamed) => {
				const [role, ...restStr] = roleStr.split(' ');
				let rest;
				try {
					rest = JSON.parse(restStr.join(' '));
				} catch (e) {
					return actionNotOK(`could not parse role ${roleStr} as JSON: ${e}`);
				}
				await this.withPage(async (page: Page) => await page.getByRole(<TAnyFixme>role, rest || {}).click());
				return OK;
			},
		},
		clickByLabel: {
			gwta: 'click by label {label}',
			action: async ({ title: label }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByLabel(label).click());
				return OK;
			},
		},
		clickByTitle: {
			gwta: 'click by title {title}',
			action: async ({ title }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByTitle(title).click());

				return OK;
			},
		},
		clickByText: {
			gwta: 'click by text {text}',
			action: async ({ text }: TNamed) => {
				await this.withPage(async (page: Page) => await page.getByText(text).click());
				return OK;
			},
		},
		clickOn: {
			gwta: 'click on (?<name>.[^s]+)',
			action: async ({ name }: TNamed) => {
				const what = this.getWorld().shared.get(name) || `text=${name}`;
				await this.withPage(async (page: Page) => await page.click(what));
				return OK;
			},
		},
		clickCheckbox: {
			gwta: 'click the checkbox (?<name>.+)',
			action: async ({ name }: TNamed) => {
				const what = this.getWorld().shared.get(name) || name;
				this.getWorld().logger.log(`click ${name} ${what}`);
				await this.withPage(async (page: Page) => await page.click(what));
				return OK;
			},
		},
		clickShared: {
			gwta: 'click `(?<id>.+)`',
			action: async ({ id }: TNamed) => {
				const name = this.getWorld().shared.get(id);
				await this.withPage(async (page: Page) => await page.click(name));
				return OK;
			},
		},
		clickQuoted: {
			gwta: 'click "(?<name>.+)"',
			action: async ({ name }: TNamed) => {
				await this.withPage(async (page: Page) => await page.click(`text=${name}`));
				return OK;
			},
		},
		clickLink: {
			// TODO: generalize modifier
			gwta: 'click( with alt)? the link {name}',
			action: async ({ name }: TNamed, featureStep: TFeatureStep) => {
				const modifier = featureStep.in.match(/ with alt /) ? { modifiers: ['Alt'] } : {};
				const field = this.getWorld().shared.get(name) || name;
				await this.withPage(async (page: Page) => await page.click(field, <TAnyFixme>modifier));
				return OK;
			},
		},

		clickButton: {
			gwta: 'click the button (?<id>.+)',
			action: async ({ id }: TNamed) => {
				const field = this.getWorld().shared.get(id) || id;
				await this.withPage(async (page: Page) => await page.click(field));

				return OK;
			},
		},

		//                          NAVIGATION

		// formerly On the {name} ${WEB_PAGE}
		gotoPage: {
			gwta: `go to the {name} ${WEB_PAGE}`,
			action: async ({ name }: TNamed) => {
				const response = await this.withPage<Response>(async (page: Page) => {
					return await page.goto(name);
				});

				return response?.ok
					? OK
					: actionNotOK(`response not ok`, {
						topics: { response: { ...response?.allHeaders, summary: response?.statusText() } },
					});
			},
		},
		reloadPage: {
			gwta: 'reload page',
			action: async () => {
				await this.withPage(async (page: Page) => await page.reload());
				return OK;
			},
		},

		goBack: {
			gwta: 'go back',
			action: async () => {
				await this.withPage(async (page: Page) => await page.goBack());
				return OK;
			},
		},

		blur: {
			gwta: 'blur {what}',
			action: async ({ what }: TNamed) => {
				await this.withPage(async (page: Page) => await page.locator(what).evaluate((e) => e.blur()));
				return OK;
			},
		},

		//                         BROWSER
		usingBrowserVar: {
			gwta: 'using {browser} browser',
			action: async ({ browser }: TNamed) => {

				if (!BROWSERS[browser]) {
					throw Error(`browserType not recognized ${browser} from ${BROWSERS.toString()}`);
				}
				return Promise.resolve(this.setBrowser(browser));
			},
		},

		//  FILE DOWNLOAD/UPLOAD
		uploadFile: {
			gwta: 'upload file {file} using {selector}',
			action: async ({ file, selector }: TNamed) => {
				await this.withPage(async (page: Page) => await page.setInputFiles(selector, file));
				return OK;
			},
		},

		waitForFileChooser: {
			gwta: 'upload file {file} with {selector}',
			action: async ({ file, selector }: TNamed) => {
				try {
					await this.withPage(async (page: Page) => {
						const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#uploadFile').click()]);
						const changeButton = page.locator(selector);
						await changeButton.click();

						await fileChooser.setFiles(file);
					});
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		expectDownload: {
			gwta: 'expect a download',
			action: async () => {
				try {
					this.expectedDownload = this.withPage<Download>(async (page: Page) => page.waitForEvent('download'));
					return Promise.resolve(OK);
				} catch (e) {
					return Promise.resolve(actionNotOK(e));
				}
			},
		},
		receiveDownload: {
			gwta: 'receive download as {file}',
			action: async ({ file }: TNamed) => {
				try {
					const download = await this.expectedDownload;
					await await download.saveAs(file);
					this.downloaded.push(file);
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		waitForDownload: {
			gwta: 'save download to {file}',
			action: async ({ file }: TNamed) => {
				try {
					const download = <Download>await this.withPage(async (page: Page) => page.waitForEvent('download'));

					await download.saveAs(file);
					this.downloaded.push(file);
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},

		//                          MISC
		withFrame: {
			gwta: 'with frame {name}',
			action: async ({ name }: TNamed) => {
				this.withFrame = name;
				return Promise.resolve(OK);
			},
		},
		captureDialog: {
			gwta: 'Accept next dialog to {where}',
			action: async ({ where }: TNamed) => {
				await this.withPage(async (page: Page) => {
					return page.on('dialog', async (dialog) => {
						const res = {
							defaultValue: dialog.defaultValue(),
							message: dialog.message(),
							type: dialog.type(),
						};
						await dialog.accept();
						this.getWorld().shared.set(where, res);
					});
					return Promise.resolve();
				}
				);
				return Promise.resolve(OK);
			},
		},
		takeScreenshot: {
			gwta: 'take a screenshot',
			action: async (notUsed, featureStep: TFeatureStep) => {
				try {
					await this.captureScreenshotAndLog('request', EExecutionMessageType.ACTION, featureStep);
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		assertOpen: {
			gwta: '{what} is expanded with the {using}',
			action: async ({ what, using }: TNamed) => {
				const isVisible = await this.withPage(async (page: Page) => await page.isVisible(what));
				if (!isVisible) {
					await this.withPage(async (page: Page) => await page.click(using));
				}
				return OK;
			},
		},
		setToURIQueryParameter: {
			gwta: 'save URI query parameter {what} to {where}',
			action: async ({ what, where }: TNamed) => {
				const uri = await this.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(what);
				this.getWorld().shared.set(where, found);
				return OK;
			},
		},
		resizeWindow: {
			gwta: 'resize window to {width}x{height}',
			action: async ({ width, height }: TNamed) => {
				await this.withPage(
					async (page: Page) => await page.setViewportSize({ width: parseInt(width), height: parseInt(height) })
				);
				return OK;
			},
		},
	};
	setBrowser(browser: string) {
		this.factoryOptions.type = browser as unknown as TBrowserTypes;
		return OK;
	}
	newTab() {
		this.tab = this.tab + 1;
	}
	async captureFailureScreenshot(event: 'failure', stage: EExecutionMessageType, step: TFeatureStep) {
		try {
			return await this.captureScreenshotAndLog(event, stage, { step });
		} catch (e) {
			this.getWorld().logger.debug(`captureFailureScreenshot error ${e}`);
		}
	}

	async captureScreenshotAndLog(event: 'failure' | 'request', stage: EExecutionMessageType, details: { seq?: number; step?: TFeatureStep }) {
		const { context, path } = await this.captureScreenshot(event, stage, details,); // Destructure 'context' instead of 'artifactTopic'
		this.getWorld().logger.log(`${event} screenshot to ${pathToFileURL(path)}`, context); // Use 'context' instead of 'artifactTopic'
	}

	async captureScreenshot(event: 'failure' | 'request', stage: EExecutionMessageType, details: { seq?: number; step?: TFeatureStep }) {
		const loc = await this.getCaptureDir('image');
		// FIXME shouldn't be fs dependant
		const path = resolve(this.storage.fromLocation(EMediaTypes.image, loc, `${event}-${Date.now()}.png`));
		await this.withPage(async (page: Page) => await page.screenshot({ path }));
		const artifact: TArtifactImage = { artifactType: 'image', path: await this.storage.getRelativePath(path) };
		// Create context using the new structure
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION, // Assuming ACTION is appropriate here
			artifact,
			tag: this.getWorld().tag,
			incidentDetails: { ...details, event, stage } // Store original topic details if needed
		};
		// Return the context and path (adjusting the return type of the calling function might be needed)
		return { context, path };
		// Remove duplicate/incorrect return statement
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
			} catch (e: TAnyFixme) {
				throw new Error(`Evaluate fetch error: ${JSON.stringify({ endpoint, method, headers, ua })} : ${e.message}. Page console messages: ${pageConsoleMessages.map(msg => `[${msg.type}] ${msg.text}`).join('; ')}`);
			}
		} catch (e: TAnyFixme) {
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
		if (WebPlaywright.monitorPage && !WebPlaywright.monitorPage.isClosed()) {
			console.log("Monitor page already exists.");
			await WebPlaywright.monitorPage.bringToFront();
			return OK;
		}
		const { monitorPage, subscriber } = await (await createMonitorPageAndSubscriber())();
		WebPlaywright.monitorPage = monitorPage;
		this.getWorld().logger.addSubscriber(subscriber);

		this.closers.push(async () => {
			console.log("Removing monitor logger subscriber.");
			this.getWorld().logger.removeSubscriber(subscriber);
			return Promise.resolve();
		});
		return OK;
	}
}

export default WebPlaywright;
