import { Page, Response, Download } from "playwright";

import { OK, TNamed, TFeatureStep } from "@haibun/core/build/lib/defs.js";
import { WEB_CONTROL, WEB_PAGE } from "@haibun/core/build/lib/domain-types.js";
import { TAnyFixme } from "@haibun/core/build/lib/fixme.js";
import { EExecutionMessageType } from "@haibun/core/build/lib/interfaces/logger.js";
import { sleep, actionNotOK } from "@haibun/core/build/lib/util/index.js";
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
	seeTestId: {
		gwta: 'has test id {testId}',
		action: async ({ testId }: TNamed) => {
			const found = await wp.withPage(async (page: Page) => await page.getByTestId(testId));
			return found ? OK : actionNotOK(`Did not find test id ${testId}`);
		},
	},
	seeTextIn: {
		gwta: 'in {selector}, see {text}',
		action: async ({ text, selector }: TNamed) => {
			return await wp.sees(text, selector);
		},
	},
	seeText: {
		gwta: 'see {text}',
		action: async ({ text }: TNamed) => {
			return await wp.sees(text, 'body');
		},
	},
	waitFor: {
		gwta: 'wait for {what}',
		action: async ({ what }: TNamed) => {
			const selector = what.match(/^[.#]/) ? what : `text=${what}`;
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
	onNewPage: {
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
	URIContains: {
		gwta: 'URI includes {what}',
		action: async ({ what }: TNamed) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			return uri.includes(what) ? OK : actionNotOK(`current URI ${uri} does not contain ${what}`);
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
		gwta: 'URI matches {what}',
		action: async ({ what }: TNamed) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			return uri.match(what) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
		},
	},
	caseInsensitiveURIMatches: {
		gwta: 'URI case insensitively matches {what}',
		action: async ({ what }: TNamed) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const matcher = new RegExp(what, 'i');
			return uri.match(matcher) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
		},
	},

	//                  CLICK

	clickByAltText: {
		gwta: 'click by alt text {altText}',
		action: async ({ altText }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByAltText(altText).click());
			return OK;
		},
	},
	clickByTestId: {
		gwta: 'click by test id {testId}',
		action: async ({ testId }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByTestId(testId).click());
			return OK;
		},
	},
	clickByPlaceholder: {
		gwta: 'click by placeholder {placeholder}',
		action: async ({ placeholder }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByPlaceholder(placeholder).click());
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
			await wp.withPage(async (page: Page) => await page.getByRole(<TAnyFixme>role, rest || {}).click());
			return OK;
		},
	},
	clickByLabel: {
		gwta: 'click by label {label}',
		action: async ({ title: label }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByLabel(label).click());
			return OK;
		},
	},
	clickByTitle: {
		gwta: 'click by title {title}',
		action: async ({ title }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByTitle(title).click());

			return OK;
		},
	},
	clickByText: {
		gwta: 'click by text {text}',
		action: async ({ text }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.getByText(text).click());
			return OK;
		},
	},
	clickOn: {
		gwta: 'click on (?<name>.[^s]+)',
		action: async ({ name }: TNamed) => {
			const what = wp.getWorld().shared.get(name) || `text=${name}`;
			await wp.withPage(async (page: Page) => await page.click(what));
			return OK;
		},
	},
	clickCheckbox: {
		gwta: 'click the checkbox (?<name>.+)',
		action: async ({ name }: TNamed) => {
			const what = wp.getWorld().shared.get(name) || name;
			wp.getWorld().logger.log(`click ${name} ${what}`);
			await wp.withPage(async (page: Page) => await page.click(what));
			return OK;
		},
	},
	clickShared: {
		gwta: 'click `(?<id>.+)`',
		action: async ({ id }: TNamed) => {
			const name = wp.getWorld().shared.get(id);
			await wp.withPage(async (page: Page) => await page.click(name));
			return OK;
		},
	},
	clickQuoted: {
		gwta: 'click "(?<name>.+)"',
		action: async ({ name }: TNamed) => {
			await wp.withPage(async (page: Page) => await page.click(`text=${name}`));
			return OK;
		},
	},
	clickLink: {
		// TODO: generalize modifier
		gwta: 'click( with alt)? the link {name}',
		action: async ({ name }: TNamed, featureStep: TFeatureStep) => {
			const modifier = featureStep.in.match(/ with alt /) ? { modifiers: ['Alt'] } : {};
			const field = wp.getWorld().shared.get(name) || name;
			await wp.withPage(async (page: Page) => await page.click(field, <TAnyFixme>modifier));
			return OK;
		},
	},

	clickButton: {
		gwta: 'click the button (?<id>.+)',
		action: async ({ id }: TNamed) => {
			const field = wp.getWorld().shared.get(id) || id;
			await wp.withPage(async (page: Page) => await page.click(field));

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
