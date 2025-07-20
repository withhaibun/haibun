import { Download, Page, Response } from "playwright";

import { OK, TFeatureStep, TNamed } from "@haibun/core/lib/defs.js";
import { WEB_CONTROL, WEB_PAGE } from "@haibun/core/lib/domain-types.js";
import { TAnyFixme } from "@haibun/core/lib/fixme.js";
import { EExecutionMessageType } from "@haibun/core/lib/interfaces/logger.js";
import { actionNotOK, actionOK, sleep } from "@haibun/core/lib/util/index.js";
import { BROWSERS } from "./BrowserFactory.js";
import { WebPlaywright } from "./web-playwright.js";

export const interactionSteps = (wp: WebPlaywright) => ({
	//                                      INPUT
	press: {
		gwta: `press {key}`,
		action: async ({ key }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.keyboard.press(key));
			return OK;
		},
	},
	type: {
		gwta: `type {text}`,
		action: async ({ text }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.keyboard.type(text));
			return OK;
		},
	},
	inputVariable: {
		gwta: `input {what} for {field}`,
		action: async ({ what, field }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.locator(field).fill(what));
			return OK;
		},
	},
	selectionOption: {
		gwta: `select {option} for {field: ${WEB_CONTROL}}`,
		action: async ({ option, field }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.selectOption(field, { label: option }));
			// FIXME have to use id value
			return OK;
		},
	},

	//                ASSERTIONS
	dialogIs: {
		gwta: 'dialog {what} {type} says {value}',
		action: async ({ what, type, value }: TNamed) => {
			const cur = wp.getWorld().shared.get(what)?.[type];

			return Promise.resolve(cur === value ? OK : actionNotOK(`${what} is ${cur}`));
		},
	},
	dialogIsUnset: {
		gwta: 'dialog {what} {type} not set',
		action: async ({ what, type }: TNamed) => {
			const cur = wp.getWorld().shared.get(what)?.[type];
			return Promise.resolve(!cur ? OK : actionNotOK(`${what} is ${cur}`));
		},
	},
	shouldSeeTestId: {
		gwta: 'has test id {testId}',
		action: async ({ testId }: TNamed) => {
			const found = await wp.withPage(async (page: Page) => await page.getByTestId(testId));
			return found ? OK : actionNotOK(`Did not find test id ${testId}`);
		},
	},
	shouldSeeTextIn: {
		gwta: 'in {selector}, see {text}',
		action: async ({ text, selector }: TNamed) => {
			return await wp.sees(text, selector);
		},
	},
	shouldSeeText: {
		gwta: 'see {text}',
		action: async ({ text }: TNamed) => {
			return await wp.sees(text, 'body');
		},
	},
	waitFor: {
		gwta: 'wait for {what}',
		action: async ({ what }: TNamed) => {
			const selector = what.match(/^[#]/) ? what : `text=${what}`;
			const found = await wp.withPage(async (page: Page) => await page.waitForSelector(selector));
			if (found) {
				return OK;
			}
			return actionNotOK(`Did not find ${what}`);
		},
	},

	createMonitor: {
		gwta: 'create monitor',
		action: async () => {
			await wp.createMonitor();
			return OK;
		},
	},
	finishMonitor: {
		gwta: 'finish monitor',
		action: async () => {
			await WebPlaywright.monitorHandler.writeMonitor();
			return OK;
		},
	},
	onNewTab: {
		gwta: `on a new tab`,
		action: async () => {
			wp.newTab();
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

			while (wp.tab !== waitForTab && !timedOut) {
				await sleep(100);
			}

			return wp.tab === waitForTab ? OK : actionNotOK(`current tab is ${wp.tab}, not ${waitForTab}`);
		},
	},
	onTabX: {
		gwta: `on tab {tab}`,
		action: async ({ tab }: TNamed) => {
			wp.tab = parseInt(tab, 10);
			return Promise.resolve(OK);
		},
	},
	beOnPage: {
		gwta: `be on the {name} ${WEB_PAGE}`,
		action: async ({ name }: TNamed) => {
			const nowon = await wp.withPage(async (page: Page) => {
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
			if (!wp.factoryOptions?.persistentDirectory || wp.factoryOptions?.launchOptions.headless) {
				throw Error(`extensions require ${WebPlaywright.PERSISTENT_DIRECTORY} and not HEADLESS`);
			}
			const browserContext = await wp.getExistingBrowserContext();
			if (!browserContext) {
				throw Error(`no browserContext`);
			}

			const background = browserContext?.serviceWorkers()[0];

			if (!background) {
				// background = await context.waitForEvent("serviceworker");
			}

			console.debug('background', background, browserContext.serviceWorkers());

			const extensionId = background.url().split('/')[2];
			wp.getWorld().shared.set('extensionContext', extensionId);
			await wp.withPage(async (page: Page) => {
				const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
				return await page.goto(popupURI);
			});

			return OK;
		},
	},
	cookieIs: {
		gwta: 'cookie {name} is {value}',
		action: async ({ name, value }: TNamed) => {
			const cookies = await wp.getCookies();
			const found = cookies?.find((c) => c.name === name && c.value === value);
			return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
		},
	},
	URIQueryParameterIs: {
		gwta: 'URI query parameter {what} is {value}',
		action: async ({ what, value }: TNamed) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
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
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			return uri.startsWith(start) ? OK : actionNotOK(`current URI ${uri} does not start with ${start}`);
		},
	},
	URIMatches: {
		gwta: 'URI(case insensitively)? matches {what}',
		action: async ({ what }: TNamed, featureStep) => {
			const modifier = featureStep.in.match(/ case insensitively /) ? 'i' : '';
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const matcher = new RegExp(what, modifier);
			return uri.match(matcher) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
		},
	},

	//                  CLICK
	click: {
		gwta: `click {what}`,
		action: async ({ what }: TNamed) => {
			const isCssSelector = /^[#.[[]|::|>>/.test(what) || what.includes('=');
			if (isCssSelector) {
				await wp.withPage(async (page: Page) => await page.locator(what).click());
			} else {
				await wp.withPage(async (page: Page) => await page.getByText(what, { exact: true }).click());
			}
			return OK;
		}
	},
	clickBy: {
		gwta: `by {method}, click {what}`,
		action: async ({ what, method }: TNamed) => {
			let withModifier = {};

			const bys = {
				'alt text': (page: Page) => page.getByAltText(what),
				'test id': (page: Page) => page.getByTestId(what),
				placeholder: (page: Page) => page.getByPlaceholder(what),
				role: (page: Page) => page.getByRole(what as Parameters<Page['getByRole']>[0]),
				label: (page: Page) => page.getByLabel(what),
				title: (page: Page) => page.getByTitle(what),
				text: (page: Page) => page.getByText(what, { exact: true }),
				dispatch: (page: Page) => page.locator(what).dispatchEvent('click'),
				modifier: (page: Page) => {
					withModifier = JSON.parse(method);
					return page.locator(what);
				}
			};
			if (!bys[method]) {
				return actionNotOK(`unknown click by "${method}" from ${Object.keys(bys).toString()}`);
			}
			await wp.withPage(async (page: Page) => {
				const locatorResult = bys[method](page);
				await locatorResult.click(withModifier);
			});
			return OK;
		},
	},
	//                          NAVIGATION

	// formerly On the {name} ${WEB_PAGE}
	gotoPage: {
		gwta: `go to the {name} ${WEB_PAGE}`,
		action: async ({ name }: TNamed) => {
			const response = await wp.withPage<Response>(async (page: Page) => {
				return await page.goto(name);
			});
			const messageContext = {
				incident: EExecutionMessageType.ACTION,
				incidentDetails: { ...response?.allHeaders, summary: response?.statusText() }
			}
			return response?.ok ? OK : actionNotOK(`response not ok`, { messageContext });
		},
	},
	reloadPage: {
		gwta: 'reload page',
		action: async () => {
			await wp.withPage(async (page: Page) => await page.reload());
			return OK;
		},
	},

	goBack: {
		gwta: 'go back',
		action: async () => {
			await wp.withPage(async (page: Page) => await page.goBack());
			return OK;
		},
	},

	blur: {
		gwta: 'blur {what}',
		action: async ({ what }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.locator(what).evaluate((e) => e.blur()));
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
			return Promise.resolve(wp.setBrowser(browser));
		},
	},

	//  FILE DOWNLOAD/UPLOAD
	uploadFile: {
		gwta: 'upload file {file} using {selector}',
		action: async ({ file, selector }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.setInputFiles(selector, file));
			return OK;
		},
	},

	waitForFileChooser: {
		gwta: 'upload file {file} with {selector}',
		action: async ({ file, selector }: TNamed) => {
			try {
				await wp.withPage(async (page: Page) => {
					const [fileChooser] = await Promise.all([
						page.waitForEvent('filechooser'),
						page.locator(selector).click()
					]);
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
				wp.expectedDownload = wp.withPage<Download>(async (page: Page) => page.waitForEvent('download'));
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
				const download = await wp.expectedDownload;
				await download.saveAs(file);
				wp.downloaded.push(file);
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
				const download = <Download>await wp.withPage(async (page: Page) => page.waitForEvent('download'));

				await download.saveAs(file);
				wp.downloaded.push(file);
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
			wp.withFrame = name;
			return Promise.resolve(OK);
		},
	},
	captureDialog: {
		gwta: 'Accept next dialog to {where}',
		action: async ({ where }: TNamed) => {
			await wp.withPage((page: Page) => {
				return page.on('dialog', async (dialog) => {
					const res = {
						defaultValue: dialog.defaultValue(),
						message: dialog.message(),
						type: dialog.type(),
					};
					await dialog.accept();
					wp.getWorld().shared.setJSON(where, res);
				});
			}
			);
			return Promise.resolve(OK);
		},
	},
	takeScreenshot: {
		gwta: 'take a screenshot',
		action: async (notUsed, featureStep: TFeatureStep) => {
			try {
				await wp.captureScreenshotAndLog(EExecutionMessageType.ACTION, featureStep);
				return OK;
			} catch (e) {
				return actionNotOK(e);
			}
		},
	},
	getPageContents: {
		gwta: 'get page contents',
		action: async () => {
			const contents = await wp.withPage<string>(async (page: Page) => await page.content());
			const messageContext = {
				incident: EExecutionMessageType.ACTION,
				artifact: {
					artifactType: 'html' as const,
					html: contents || ''
				}
			};
			return actionOK(messageContext);
		}
	},
	takeAccessibilitySnapshot: {
		gwta: 'take an accessibility snapshot',
		action: async () => {
			const snapshot = await wp.captureAccessibilitySnapshot();
			const artifact = {
				artifactType: 'json' as const,
				json: (snapshot as object) || {}
			};
			const messageContext = {
				incident: EExecutionMessageType.ACTION,
				tag: wp.getWorld().tag,
				artifact
			};
			wp.getWorld().logger.info('Accessibility snapshot captured', messageContext);
			return OK;
		},
	},
	assertOpen: {
		gwta: '{what} is expanded with the {using}',
		action: async ({ what, using }: TNamed) => {
			const isVisible = await wp.withPage(async (page: Page) => await page.isVisible(what));
			if (!isVisible) {
				await wp.withPage(async (page: Page) => await page.click(using));
			}
			return OK;
		},
	},
	setToURIQueryParameter: {
		gwta: 'save URI query parameter {what} to {where}',
		action: async ({ what, where }: TNamed) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const found = new URL(uri).searchParams.get(what);
			wp.getWorld().shared.set(where, found);
			return OK;
		},
	},
	resizeWindow: {
		gwta: 'resize window to {width}x{height}',
		action: async ({ width, height }: TNamed) => {
			await wp.withPage(
				async (page: Page) => await page.setViewportSize({ width: parseInt(width), height: parseInt(height) })
			);
			return OK;
		},
	},
	resizeAvailable: {
		gwta: 'resize window to largest dimensions',
		action: async () => {
			await wp.withPage(
				async (page: Page) => {
					const { availHeight: height, availWidth: width } = await page.evaluate(() => ({ availHeight: window.screen.availHeight, availWidth: window.screen.availWidth }));
					return await page.setViewportSize({ width, height });
				}
			);
			return OK;
		},
	},
	usingTimeout: {
		gwta: 'using timeout of {timeout}ms',
		action: async ({ timeout }: TNamed) => {
			const timeoutMs = parseInt(timeout, 10);
			await wp.withPage((page: Page) => {
				page.setDefaultTimeout(timeoutMs);
				page.setDefaultNavigationTimeout(timeoutMs);
			});
			return OK;
		},
	},
	openDevTools: {
		gwta: `open devtools`,
		action: async () => {
			await wp.withPage(async (page: Page) => {
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
});
