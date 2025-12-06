import { Download, Page, Response } from "playwright";
type ClickResult = import('playwright').Locator;

import { OK, Origin, TActionResult, TFeatureStep } from "@haibun/core/lib/defs.js";
import { DOMAIN_STATEMENT, DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";
import { actionNotOK, sleep } from "@haibun/core/lib/util/index.js";
import { DOMAIN_PAGE_LOCATOR } from "./domains.js";
import { WEB_PAGE, WebPlaywright } from "./web-playwright.js";
import { BROWSERS } from "./BrowserFactory.js";
import { EExecutionMessageType } from "@haibun/core/lib/interfaces/logger.js";
import { actionOK } from "@haibun/core/lib/util/index.js";
import { pathToFileURL } from 'node:url';
import { TStepperSteps } from "@haibun/core/lib/astepper.js";
import { provenanceFromFeatureStep } from "@haibun/core/steps/variables-stepper.js";
import { FlowRunner } from "@haibun/core/lib/core/flow-runner.js";

const DOMAIN_STRING_OR_PAGE_LOCATOR = `${DOMAIN_STRING} | ${DOMAIN_PAGE_LOCATOR}`;

export const interactionSteps = (wp: WebPlaywright) => ({
	// INPUT
	press: {
		gwta: 'press {key}',
		action: async ({ key }: { key: string }) => {
			await wp.withPage(async (page: Page) => await page.keyboard.press(key));
			return OK;
		},
	},
	type: {
		gwta: 'type {text}',
		action: async ({ text }: { text: string }) => {
			await wp.withPage(async (page: Page) => await page.keyboard.type(text));
			return OK;
		},
	},
	inputVariable: {
		gwta: `input {what} for {field: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ what, field }: { what: string; field: string }, featureStep: TFeatureStep) => {
			void field;
			await wp.withPage(async (page: Page) => await locateByDomain(page, featureStep, 'field').fill(what));
			return OK;
		},
	},
	selectionOption: {
		gwta: `select {option} for {field: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ option, field }: { option: string; field: string }, featureStep: TFeatureStep) => {
			void field;
			await wp.withPage(async (page: Page) => await locateByDomain(page, featureStep, 'field').selectOption({ label: option }));
			return OK;
		},
	},
	dialogIs: {
		gwta: 'dialog {what} {type} says {value}',
		action: ({ what, type, value }: { what: string; type: string; value: string }) => {
			const cur = wp.getWorld().shared.get(what)?.[type];
			return cur === value ? OK : actionNotOK(`${what} is ${cur}`);
		},
	},
	dialogIsUnset: {
		gwta: 'dialog {what} {type} not set',
		action: ({ what, type }: { what: string; type: string }) => {
			const cur = wp.getWorld().shared.get(what)?.[type];
			return !cur ? OK : actionNotOK(`${what} is ${cur}`);
		},
	},
	shouldSeeTestId: {
		gwta: 'has test id {testId}',
		action: async ({ testId }: { testId: string }) => {
			const found = await wp.withPage(async (page: Page) => await page.getByTestId(testId));
			return found ? OK : actionNotOK(`Did not find test id ${testId}`);
		},
	},
	seeText: {
		gwta: 'see {text}',
		action: async ({ text }: { text: string }) => await wp.sees(text, 'body'),
	},
	waitFor: {
		gwta: `wait for {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
			try {
				await wp.withPage(async (page: Page) => await locateByDomain(page, featureStep, 'target').waitFor());
				return OK;
			} catch {
				return actionNotOK(`Did not find ${target}`);
			}
		},
	},

	onNewTab: {
		gwta: `on a new tab`,
		action: () => {
			wp.newTab();
			return OK;
		},
	},
	currentTabIs: {
		gwta: `current tab is {tab}`,
		action: async ({ tab }: { tab: string }) => {
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
		action: ({ tab }: { tab: string }) => {
			wp.tab = parseInt(tab, 10);
			return OK;
		},
	},
	beOnPage: {
		gwta: `be on the {name} ${WEB_PAGE}`,
		action: async ({ name }: { name: string }) => {
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
		expose: false,
		gwta: `open extension popup for tab {tab}`,
		action: async ({ tab }: { tab: string }, featureStep) => {
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
			wp.getWorld().shared.set({ term: 'extensionContext', value: extensionId, domain: 'string', origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			await wp.withPage(async (page: Page) => {
				const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
				return await page.goto(popupURI);
			});

			return OK;
		},
	},
	cookieIs: {
		gwta: 'cookie {name} is {value}',
		action: async ({ name, value }: { name: string; value: string }) => {
			const cookies = await wp.getCookies();
			const found = cookies?.find((c) => c.name === name && c.value === value);
			return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
		},
	},
	URIQueryParameterIs: {
		gwta: 'URI query parameter {what} is {value}',
		action: async ({ value }: { value: string }, featureStep) => {
			const { term } = featureStep.action.stepValuesMap.what;
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const found = new URL(uri).searchParams.get(term);
			if (found === value) {
				return OK;
			}
			return actionNotOK(`URI query ${term} contains "${found}", not "${value}"`);
		},
	},
	URIStartsWith: {
		gwta: 'URI starts with {start}',
		action: async ({ start }: { start: string }) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			return uri.startsWith(start) ? OK : actionNotOK(`current URI ${uri} does not start with ${start}`);
		},
	},
	URIMatches: {
		gwta: 'URI(case insensitively)? matches {what}',
		action: async ({ what }: { what: string }, featureStep) => {
			const modifier = featureStep.in.match(/ case insensitively /) ? 'i' : '';
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const matcher = new RegExp(what, modifier);
			return uri.match(matcher) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
		},
	},

	//                  CLICK
	click: {
		gwta: `click {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ target }: { target: string }, featureStep) => {
			void target; // used for type checking
			await wp.withPage(async (page: Page) => {
				return await locateByDomain(page, featureStep, 'target').click();
			});
			return OK;
		},
	},
	inElement: {
		gwta: `in {container: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}, {what: ${DOMAIN_STATEMENT}}`,
		action: async ({ what }: { container: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
			return await wp.withPage(async (page: Page) => {
				const containerLocator = locateByDomain(page, featureStep, 'container');
				wp.inContainer = containerLocator;

				const runner = new FlowRunner(wp.getWorld(), [wp]);
				const result = await runner.runSteps(what);

				wp.inContainer = undefined;

				if (result.kind === 'ok') {
					return result.payload as TActionResult;
				} else {
					return actionNotOK(result.message);
				}
			});
		},
	},
	clickBy: {
		precludes: [`${wp.constructor.name}.click`],
		gwta: `click {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}} by {method}`,
		action: async ({ target, method }: { target: string; method: string }, featureStep: TFeatureStep) => {
			let withModifier: Record<string, unknown> = {};

			const bys: Record<string, (page: Page) => ClickResult | Promise<void>> = {
				'alt text': (page: Page) => page.getByAltText(target),
				'test id': (page: Page) => page.getByTestId(target),
				placeholder: (page: Page) => page.getByPlaceholder(target),
				role: (page: Page) => page.getByRole(target as Parameters<Page['getByRole']>[0]),
				label: (page: Page) => page.getByLabel(target),
				title: (page: Page) => page.getByTitle(target),
				text: (page: Page) => page.getByText(target),
				modifier: (page: Page) => {
					withModifier = JSON.parse(method);
					return locateByDomain(page, featureStep, 'target');
				},
			};
			if (!bys[method]) {
				return actionNotOK(`unknown click by "${method}" from ${Object.keys(bys).toString()} `);
			}
			await wp.withPage(async (page: Page) => {
				const locatorResult = bys[method](page);
				const maybeLocator = locatorResult as unknown;
				if (typeof maybeLocator === 'object' && maybeLocator && 'click' in maybeLocator) {
					await (maybeLocator as import('playwright').Locator).click(withModifier);
				}
			});
			return OK;
		},
	},
	//                          NAVIGATION

	gotoPage: {
		gwta: `go to the { name } ${WEB_PAGE}`,
		action: async ({ name }: { name: string }) => {
			const response = await wp.withPage<Response | null>(async (page: Page) => {
				return await page.goto(name);
			});
			const messageContext = {
				incident: EExecutionMessageType.ACTION,
				incidentDetails: { ...(response?.allHeaders || {}), summary: response?.statusText() }
			};
			return response?.ok() ? OK : actionNotOK(`response not ok`, { messageContext });
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
		gwta: `blur {what: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ what }: { what: string }, featureStep: TFeatureStep) => {
			void what;
			await wp.withPage(async (page: Page) => await locateByDomain(page, featureStep, 'what').evaluate((e) => e.blur()));
			return OK;
		},
	},

	//                         BROWSER
	usingBrowserVar: {
		gwta: 'using {browser} browser',
		action: ({ browser }: { browser: string }) => {
			if (!BROWSERS[browser]) {
				throw Error(`browserType not recognized ${browser} from ${BROWSERS.toString()} `);
			}
			return wp.setBrowser(browser);
		},
	},

	//  FILE DOWNLOAD/UPLOAD
	uploadFile: {
		gwta: `upload file {file} using {selector: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ file, selector }: { file: string; selector: string }, featureStep: TFeatureStep) => {
			void selector;
			await wp.withPage(async (page: Page) => await locateByDomain(page, featureStep, 'selector').setInputFiles(file));
			return OK;
		},
	},

	waitForFileChooser: {
		gwta: `upload file {file} with {selector: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
		action: async ({ file, selector }: { file: string; selector: string }, featureStep: TFeatureStep) => {
			void selector;
			try {
				await wp.withPage(async (page: Page) => {
					const [fileChooser] = await Promise.all([
						page.waitForEvent('filechooser'),
						locateByDomain(page, featureStep, 'selector').click()
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
		action: () => {
			try {
				wp.expectedDownload = wp.withPage<Download>(async (page: Page) => page.waitForEvent('download'));
				return OK;
			} catch (e) {
				return actionNotOK(e);
			}
		},
	},
	receiveDownload: {
		gwta: 'receive download as {file}',
		action: async ({ file }: { file: string }) => {
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
		action: async ({ file }: { file: string }) => {
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
	captureDialog: {
		gwta: 'accept next dialog to {where}',
		action: async ({ where }: { where: string }, featureStep) => {
			await wp.withPage((page: Page) => {
				return page.on('dialog', async (dialog) => {
					const res = {
						defaultValue: dialog.defaultValue(),
						message: dialog.message(),
						type: dialog.type(),
					};
					await dialog.accept();
					wp.getWorld().shared.setJSON(where, res, Origin.var, featureStep);
				});
			});
			return OK;
		},
	},
	canvasIsEmpty: {
		gwta: 'canvas {what} is empty',
		action: async ({ what }: { what: string }) => {
			const isNotEmpty = await wp.withPage<boolean>(async (page: Page) => {
				const locator = page.locator(what);

				try {
					await locator.waitFor({ state: 'attached', timeout: 1000 });
				} catch (error: unknown) {
					if (typeof error === 'object' && error && 'name' in error && (error as { name?: string }).name === 'TimeoutError') {
						return false;
					}
					throw error;
				}

				return await locator.evaluate((canvas: HTMLCanvasElement) => {
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						return false;
					}
					const pixelBuffer = new Uint32Array(
						ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer
					);
					return pixelBuffer.some(color => color !== 0);
				});
			});

			return !isNotEmpty ? OK : actionNotOK(`canvas ${what} is not empty`);
		},
	},
	takeScreenshotOf: {
		gwta: `take a screenshot of {what: ${DOMAIN_STRING_OR_PAGE_LOCATOR}} to {where}`,
		action: async ({ what, where }: { what: string; where: string }, featureStep: TFeatureStep) => {
			try {
				await wp.withPage(async (page: Page) => {
					const locator = await locateByDomain(page, featureStep, 'what');
					if (await locator.count() !== 1) {
						throw Error(`no single ${what} from ${locator} `);
					}
					await locator.screenshot({ path: where });
					wp.getWorld().logger.info(`screenshot of ${what} saved to ${pathToFileURL(where)} `);
				});
				return OK;
			} catch (e) {
				return actionNotOK(e);
			}
		},
	},
	takeScreenshot: {
		gwta: 'take a screenshot',
		action: async () => {
			await wp.captureScreenshotAndLog(EExecutionMessageType.ACTION, {});
			return OK;
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
		},
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
	saveURIQueryParameter: {
		gwta: 'save URI query parameter {what} to {where}',
		action: async ({ what, where }: { what: string; where: string }, featureStep) => {
			const uri = await wp.withPage<string>(async (page: Page) => await page.url());
			const found = new URL(uri).searchParams.get(what);
			wp.getWorld().shared.set({ term: where, value: found, domain: 'string', origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			return OK;
		},
	},
	resizeWindow: {
		gwta: 'resize window to {width}x{height}',
		action: async ({ width, height }: { width: string; height: string }) => {
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
		action: async ({ timeout }: { timeout: string }) => {
			const timeoutMs = parseInt(timeout, 10);
			await wp.withPage((page: Page) => {
				page.setDefaultTimeout(timeoutMs);
				page.setDefaultNavigationTimeout(timeoutMs);
			});
			return OK;
		},
	}
} as const satisfies TStepperSteps);


function locateByDomain(page: Page, featureStep: TFeatureStep, where: string) {
	const value = featureStep.action.stepValuesMap[where].value as string
	const located = (featureStep.action.stepValuesMap[where].domain === 'string') ? page.getByText(value, { exact: true }) : page.locator(value);
	return located;
}

