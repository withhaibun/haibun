import { Page, Response, type Locator } from "playwright";

import { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { OK, Origin, TStepResult, type TStepValue } from "@haibun/core/schema/protocol.js";
import {
	DOMAIN_GLOB,
	DOMAIN_NUMBER,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	globSource,
	DOMAIN_LINK,
	DOMAIN_FILE_PATH,
} from "@haibun/core/lib/domains.js";
import { actionNotOK, actionOKWithProducts, errorDetail, sleep, jsonArtifact } from "@haibun/core/lib/util/index.js";
import { DOMAIN_IMAGE_REFERENCE } from "@haibun/core/lib/image-reference.js";
import {
	DOMAIN_ACCESSIBILITY_SNAPSHOT,
	DOMAIN_BROWSER_EXTENSION,
	DOMAIN_FIND_WAY,
	DOMAIN_PAGE_CONTENTS,
	DOMAIN_PAGE_LOCATOR,
	DOMAIN_PAGE_TARGET,
	DOMAIN_PAGE_TEST_ID,
	DOMAIN_PAGE_TEXT,
	DOMAIN_KEYBOARD_KEY,
	DOMAIN_COOKIE_NAME,
	DOMAIN_QUERY_PARAMETER,
	DOMAIN_REQUEST_STATE,
	DOMAIN_URL_GLOB,
	REQUEST_STATE,
	type TFindWay,
	DOMAIN_BROWSER_TYPE,
	DOMAIN_DIALOG_FIELD,
} from "./domains.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { locatorDomainOf } from "./web-playwright.js";
import { WEB_PAGE, WebPlaywright } from "./web-playwright.js";
import { WEB_PLAYWRIGHT_ACTIONS } from "./actions.js";
import { DOMAIN_RELAY_ATTACHMENT } from "./relay/relay-wire.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";
import type { TBrowserTypes } from "./BrowserFactory.js";

import { pathToFileURL } from "node:url";
import { TStepperSteps } from "@haibun/core/lib/astepper.js";
import { provenanceFromFeatureStep } from "@haibun/core/steps/variables-stepper.js";
import { FlowRunner } from "@haibun/core/lib/core/flow-runner.js";

/** The steps that act on what an accessibility snapshot reads, which the snapshot links. */
const SNAPSHOT_ACTIONS = ["click", "setValue", "press", "selectionOption", "gotoPage", "goBack", "takeScreenshot"] as const;

export const interactionSteps = (wp: WebPlaywright) =>
	({
		// INPUT
		press: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `press {key: ${DOMAIN_KEYBOARD_KEY}}`,
			action: async ({ key }: { key: string }) => {
				await wp.withPage(async (page: Page) => await page.keyboard.press(key));
				return OK;
			},
		},
		type: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `type {text: ${DOMAIN_TEXT}}`,
			action: async ({ text }: { text: string }) => {
				await wp.withPage(async (page: Page) => await page.keyboard.type(text));
				return OK;
			},
		},
		setValue: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `enter {what: ${DOMAIN_TEXT}} into {field: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ what, field }: { what: string; field: TStepValue }) => {
				await wp.withPage(async (page: Page) => {
					const locator = wp.locateByDomain(page, field);
					const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
					if (tag === "select") {
						await locator.selectOption({ value: what }).catch(async () => {
							await locator.selectOption({ label: what });
						});
					} else {
						await locator.fill(what);
					}
				});
				return OK;
			},
		},
		selectionOption: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `select {option: ${DOMAIN_PAGE_TEXT}} for {field: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ option, field }: { option: string; field: TStepValue }) => {
				await wp.withPage(async (page: Page) => await wp.locateByDomain(page, field).selectOption({ label: option }));
				return OK;
			},
		},
		dialogIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `dialog {what: ${DOMAIN_VARIABLE_NAME}} {type: ${DOMAIN_DIALOG_FIELD}} says {value: ${DOMAIN_TEXT}}`,
			action: async ({ what, type, value }: { what: string; type: string; value: string }) => {
				const resolvedValue = await wp.getWorld().shared.get(what, true);
				const cur = (resolvedValue as Record<string, unknown> | undefined)?.[type];
				return cur === value ? OK : actionNotOK(`${what} is ${cur}`);
			},
		},
		dialogIsUnset: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `dialog {what: ${DOMAIN_VARIABLE_NAME}} {type: ${DOMAIN_DIALOG_FIELD}} not set`,
			action: async ({ what, type }: { what: string; type: string }) => {
				const resolvedValue = await wp.getWorld().shared.get(what, true);
				const cur = (resolvedValue as Record<string, unknown> | undefined)?.[type];
				return !cur ? OK : actionNotOK(`${what} is ${cur}`);
			},
		},
		shouldSeeTestId: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `has test id {testId: ${DOMAIN_PAGE_TEST_ID}}`,
			action: async ({ testId }: { testId: string }) => {
				// `getByTestId` returns a Locator unconditionally; the truthiness
				// check below would silently pass for absent elements. Resolve
				// by counting matching elements (traversing shadow roots, since
				// the wider waitFor implementation already does).
				const count = await wp.withPage(async (page: Page) =>
					page.evaluate((id) => {
						function walk(root: Document | ShadowRoot): boolean {
							if (root.querySelector(`[data-testid="${id}"]`)) return true;
							for (const child of root.querySelectorAll("*")) {
								if (child.shadowRoot && walk(child.shadowRoot)) return true;
							}
							return false;
						}
						return walk(document);
					}, testId),
				);
				return count ? OK : actionNotOK(`Did not find test id ${testId}`);
			},
		},
		seeText: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `see {text: ${DOMAIN_TEXT}}`,
			action: async ({ text }: { text: string }) => await wp.sees(text, "body"),
		},
		waitFor: {
			gwta: `wait for {target: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ target }: { target: TStepValue }) => {
				try {
					// A test id waits until the first matching element is attached to the DOM. Every other locator domain waits until
					// the first matching element is visible.
					const state = locatorDomainOf(target) === DOMAIN_PAGE_TEST_ID ? "attached" : "visible";
					await wp.withPage(async (scope: Page) => await wp.locateByDomain(scope, target).first().waitFor({ state }));
					return OK;
				} catch (e) {
					return actionNotOK(`Did not find ${target.value}: ${errorDetail(e)}`);
				}
			},
		},

		onNewTab: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `on a new tab`,
			action: () => {
				wp.newTab();
				return OK;
			},
		},
		currentTabIs: {
			gwta: `current tab is {tab: ${DOMAIN_NUMBER}}`,
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
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `on tab {tab: ${DOMAIN_NUMBER}}`,
			action: ({ tab }: { tab: string }) => {
				wp.tab = parseInt(tab, 10);
				return OK;
			},
		},
		beOnPage: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `be on the {name: ${DOMAIN_LINK}} ${WEB_PAGE}`,
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
		cookieIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `cookie {name: ${DOMAIN_COOKIE_NAME}} is {value: ${DOMAIN_TEXT}}`,
			action: async ({ name, value }: { name: string; value: string }) => {
				const cookies = await wp.getCookies();
				const found = cookies?.find((c) => c.name === name && c.value === value);
				return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
			},
		},
		URIQueryParameterIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `URI query parameter {what: ${DOMAIN_QUERY_PARAMETER}} is {value: ${DOMAIN_TEXT}}`,
			action: async ({ what, value }: { what: string; value: string }) => {
				const uri = await wp.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(what);
				if (found === value) {
					return OK;
				}
				return actionNotOK(`URI query ${what} contains "${found}", not "${value}"`);
			},
		},
		waitForURIMatch: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `wait until URI matches {pattern: ${DOMAIN_GLOB}}`,
			action: async ({ pattern }: { pattern: string }) => {
				// The glob as a regular expression's source once, so the polled predicate only tests location.href.
				const source = globSource(pattern);
				const page = await wp.getPage();
				try {
					await page.waitForFunction((s: string) => new RegExp(s, "s").test(location.href), source);
				} catch {
					const actual = await page.evaluate(() => location.href).catch(() => "(unavailable)");
					return actionNotOK(`URI never matched "${pattern}"; actual URI was: ${actual}`);
				}
				return OK;
			},
		},

		//                  CLICK
		click: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `click( invisible)? {target: ${DOMAIN_PAGE_TARGET}}( with force)?`,
			action: async ({ target }: { target: TStepValue }, featureStep) => {
				const forced = featureStep.in.match(/ with force$/) || featureStep.in.match(/^click invisible/) ? { force: true } : {};
				await wp.withPage(async (page: Page) => await wp.locateByDomain(page, target).click(forced));
				return OK;
			},
		},
		inElement: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `in {container: ${DOMAIN_PAGE_LOCATOR}}, {what: ${DOMAIN_STATEMENT}}`,
			description: "Runs the statement within the element the locator finds, or within the document it shows where it is an iframe.",
			action: async ({ container, what }: { container: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
				return await wp.withPage(async (page: Page) => {
					// For shadow DOM elements, use page.locator directly to ensure CSS selector is used
					const located = page.locator(container);
					wp.inContainer = (await located.evaluate((element) => element.tagName)) === "IFRAME" ? located.contentFrame().locator(":root") : located;
					try {
						const flowResult = await new FlowRunner(wp.getWorld(), [wp]).runSteps(what, { parentStep: featureStep });
						return flowResult.ok ? OK : actionNotOK(flowResult.errorMessage || "inElement flow failed");
					} finally {
						// Every caller of a running instance shares the container scope, so a failed flow must not leave it set.
						wp.inContainer = undefined;
					}
				});
			},
		},
		clickBy: {
			precludes: [`${wp.constructor.name}.click`],
			gwta: `click {target: ${DOMAIN_PAGE_TARGET}} by {method: ${DOMAIN_FIND_WAY}}`,
			action: async ({ target: { value }, method }: { target: TStepValue; method: TFindWay }) => {
				const target = String(value);
				const bys: Record<TFindWay, (page: Page) => Locator> = {
					"alt text": (page) => page.getByAltText(target),
					"test id": (page) => page.getByTestId(target),
					placeholder: (page) => page.getByPlaceholder(target),
					role: (page) => page.getByRole(target as Parameters<Page["getByRole"]>[0]),
					label: (page) => page.getByLabel(target),
					title: (page) => page.getByTitle(target),
					text: (page) => page.getByText(target),
				};
				await wp.withPage(async (page: Page) => await bys[method](page).click());
				return OK;
			},
		},
		//                          NAVIGATION

		gotoPage: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `go to the {name: ${DOMAIN_LINK}} ${WEB_PAGE}`,
			action: async ({ name }: { name: string }) => {
				const response = await wp.withPage<Response | null>(async (page: Page) => {
					const res = await page.goto(name, { waitUntil: "domcontentloaded" });
					await wp.waitForLoaded(page, "navigation");
					return res;
				});
				if (response?.ok()) return OK;
				const headers = (await response?.allHeaders().catch(() => ({}))) || {};
				return actionNotOK(`response not ok: ${response?.statusText()}`, {
					artifact: jsonArtifact({ statusText: response?.statusText() || "", headers }),
				});
			},
		},
		pageHasSettled: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "page has settled",
			action: async () => {
				await wp.withPage(async (page: Page) => {
					await wp.waitForLoaded(page, "settled");
				});
				return OK;
			},
		},
		reloadPage: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "reload page",
			action: async () => {
				await wp.withPage(async (page: Page) => await page.reload());
				return OK;
			},
		},

		goBack: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "go back",
			action: async () => {
				await wp.withPage(async (page: Page) => await page.goBack());
				return OK;
			},
		},

		blur: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `blur {what: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ what }: { what: TStepValue }) => {
				await wp.withPage(async (page: Page) => await wp.locateByDomain(page, what).evaluate((e) => e.blur()));
				return OK;
			},
		},

		//                         BROWSER
		usingBrowserVar: {
			gwta: `using {browser: ${DOMAIN_BROWSER_TYPE}} browser`,
			action: ({ browser }: { browser: TBrowserTypes }) => wp.setBrowser(browser),
		},
		connectToBrowser: {
			gwta: `connect to the browser at {endpoint: ${DOMAIN_LINK}}`,
			description:
				"Drives a running browser through its Chrome DevTools Protocol endpoint instead of launching one. Tab 0 is the one page the browser's own context holds open. The run never closes that page or that context, and leaves their dialogs to whoever runs the browser.",
			action: ({ endpoint }: { endpoint: string }) => wp.connectTo(endpoint),
		},
		loadBrowserExtension: {
			gwta: `load the browser extension at {where: ${DOMAIN_FILE_PATH}}`,
			description:
				"Loads the unpacked extension in the directory `where` into the browser the run launches, from the next page it opens, and answers the extension's id and origin, derived from the key its manifest pins, so a step can open its pages.",
			productsDomain: DOMAIN_BROWSER_EXTENSION,
			action: ({ where }: { where: string }) => wp.loadExtension(where),
		},
		showBrowserRelay: {
			// Who attached a browser, and which of their tabs, is theirs, and private.
			read: true,
			capability: readAction(Access.private),
			gwta: "show the browser relay",
			description: "Whether a person's browser is attached through the relay, the key that attached it, and its tabs, each with whether the run drives it.",
			productsDomain: DOMAIN_RELAY_ATTACHMENT,
			action: () => Promise.resolve(wp.relay ? actionOKWithProducts(wp.relay.attachment()) : actionNotOK("the browser relay is not served: `serve the browser relay` serves it")),
		},
		serveBrowserRelay: {
			gwta: "serve the browser relay",
			description:
				"Serves the relay a person's extension attaches their browser through, over `/rpc` as `relay.attach` and `relay.send`, which require `WebPlaywright:attach`, and drives that browser from the next page the run opens. The run never closes the attached browser's pages or context. With no browser attached, a step that needs the browser is refused, saying so.",
			action: () => wp.serveRelay(),
		},

		//  FILE DOWNLOAD/UPLOAD
		uploadFile: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `upload file {file: ${DOMAIN_FILE_PATH}} using {selector: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ file, selector }: { file: string; selector: TStepValue }) => {
				await wp.withPage(async (page: Page) => await wp.locateByDomain(page, selector).setInputFiles(file));
				return OK;
			},
		},

		expectDownload: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "expect a download",
			action: () => {
				// Waiting for an event isn't an action on the page, so it doesn't hold the page from the action that causes it.
				try {
					wp.expectedDownload = wp.getPage().then((page) => page.waitForEvent("download"));
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		receiveDownload: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `receive download as {file: ${DOMAIN_FILE_PATH}}`,
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
			gwta: `save download to {file: ${DOMAIN_FILE_PATH}}`,
			action: async ({ file }: { file: string }) => {
				try {
					const download = await (await wp.getPage()).waitForEvent("download");

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
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `accept next dialog to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ where }: { where: string }, featureStep) => {
				await wp.withPage((page: Page) => {
					return page.on("dialog", async (dialog) => {
						const res = {
							defaultValue: dialog.defaultValue(),
							message: dialog.message(),
							type: dialog.type(),
						};
						await dialog.accept();
						// fire-and-forget: sync dialog callback cannot await; in-memory QuadStore resolves synchronously
						void wp.getWorld().shared.setJSON(where, res, Origin.var, featureStep);
					});
				});
				return OK;
			},
		},
		canvasIsEmpty: {
			gwta: `canvas {what: ${DOMAIN_PAGE_LOCATOR}} is empty`,
			action: async ({ what }: { what: string }) => {
				const isNotEmpty = await wp.withPage<boolean>(async (page: Page) => {
					const locator = page.locator(what);

					try {
						await locator.waitFor({ state: "attached", timeout: 1000 });
					} catch (error: unknown) {
						if (typeof error === "object" && error && "name" in error && (error as { name?: string }).name === "TimeoutError") {
							return false;
						}
						throw error;
					}

					return await locator.evaluate((canvas: HTMLCanvasElement) => {
						const ctx = canvas.getContext("2d");
						if (!ctx) {
							return false;
						}
						const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
						return pixelBuffer.some((color) => color !== 0);
					});
				});

				return !isNotEmpty ? OK : actionNotOK(`canvas ${what} is not empty`);
			},
		},
		takeScreenshotOf: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `take a screenshot of {what: ${DOMAIN_PAGE_TARGET}} to {where: ${DOMAIN_FILE_PATH}}`,
			action: async ({ what, where }: { what: TStepValue; where: string }) => {
				try {
					await wp.withPage(async (page: Page) => {
						const locator = wp.locateByDomain(page, what);
						if ((await locator.count()) !== 1) {
							throw Error(`no single ${what.value} from ${locator} `);
						}
						await locator.screenshot({ path: where });
						wp.getWorld().eventLogger.info(`screenshot of ${what.value} saved to ${pathToFileURL(where)} `);
					});
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		takeScreenshot: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "take a screenshot",
			description: "Screenshots the page into the run's storage, and returns where the image's bytes are kept and their media type.",
			productsDomain: DOMAIN_IMAGE_REFERENCE,
			action: async (_args, featureStep: TFeatureStep) => {
				// Create a minimal step result for artifact tracking
				const stepResult = featureStep ? { seqPath: featureStep.seqPath, path: featureStep.source?.path, in: featureStep.in } : undefined;
				return actionOKWithProducts(await wp.captureScreenshotAndLog("action", { step: stepResult as unknown as TStepResult | undefined }));
			},
		},
		getPageContents: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "get page contents",
			productsDomain: DOMAIN_PAGE_CONTENTS,
			// The whole page HTML is the action result; keeping it on the event too can be many MB per call.
			retainProducts: false,
			action: async () => {
				const contents = await wp.withPage<string>(async (page: Page) => await page.content());
				return actionOKWithProducts({ html: contents || "" });
			},
		},
		takeAccessibilitySnapshot: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "take an accessibility snapshot",
			description:
				"Reads the page as Playwright's aria snapshot: YAML naming each element's role and accessible name, which are what the role, label and text locators address. Its links name the steps that act on what it read.",
			read: true,
			productsDomain: DOMAIN_ACCESSIBILITY_SNAPSHOT,
			action: async () => {
				const read = await wp.withPage(async (target) => {
					const page = "page" in target ? target.page() : target;
					return { url: page.url(), title: await page.title(), snapshot: await target.ariaSnapshot() };
				});
				return actionOKWithProducts({ ...read, _links: Object.fromEntries(SNAPSHOT_ACTIONS.map((step) => [step, { method: stepMethodName(wp, step) }])) });
			},
		},
		saveURI: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `save URI to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ where }: { where: string }, featureStep) => {
				const uri = await wp.withPage<string>(async (page: Page) => await page.url());
				await wp.getWorld().shared.set({ term: where, value: uri, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return OK;
			},
		},
		saveURIQueryParameter: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `save URI query parameter {what: ${DOMAIN_QUERY_PARAMETER}} to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ what, where }: { what: string; where: string }, featureStep) => {
				const uri = await wp.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(what);
				await wp.getWorld().shared.set({ term: where, value: found, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return OK;
			},
		},
		saveTextFrom: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `save text from {element: ${DOMAIN_PAGE_TARGET}} to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ element, where }: { element: TStepValue; where: string }, featureStep) => {
				const text = await wp.withPage<string>(async (page: Page) => {
					const locator = wp.locateByDomain(page, element);
					const content = await locator.textContent();
					// Empty `<div>` returns "" (not null); falling through to `inputValue()` on a non-form node throws. Trust `textContent` for any non-null return and only reach for `inputValue` when the element exposes no text node at all (rare, implies the locator hit a void element or shadow-rooted custom element with no light-DOM text).
					if (content !== null) return content.trim();
					return await locator.inputValue();
				});
				await wp.getWorld().shared.set({ term: where, value: text, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return OK;
			},
		},
		resizeWindow: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `resize window to {width: ${DOMAIN_NUMBER}}x{height: ${DOMAIN_NUMBER}}`,
			action: async ({ width, height }: { width: number; height: number }) => {
				await wp.withPage(async (page: Page) => await page.setViewportSize({ width, height }));
				return OK;
			},
		},
		resizeAvailable: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "resize window to largest dimensions",
			action: async () => {
				await wp.withPage(async (page: Page) => {
					const { availHeight: height, availWidth: width } = await page.evaluate(() => ({
						availHeight: window.screen.availHeight,
						availWidth: window.screen.availWidth,
					}));
					return await page.setViewportSize({ width, height });
				});
				return OK;
			},
		},
		requestsMatching: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `requests matching {pattern: ${DOMAIN_URL_GLOB}} are {state: ${DOMAIN_REQUEST_STATE}}`,
			description: `Block or allow the requests this page makes, by URL glob, for the rest of the feature: what a view does when the server it reads from is unreachable, and what it does when the server responds again. ${Object.values(REQUEST_STATE).join(" or ")}.`,
			action: async ({ pattern, state }: { pattern: string; state: string }) => {
				// On the page, so the state applies to this page's requests and to no other page of the context.
				await wp.withPage(async (page: Page) => {
					if (state === REQUEST_STATE.blocked) await page.route(pattern, (route) => route.abort());
					// Neither answered nor refused: the request is taken and left, which is what a page reading a site that
					// has stopped answering is given.
					else if (state === REQUEST_STATE.unanswered) await page.route(pattern, () => undefined);
					else await page.unroute(pattern);
				});
				return OK;
			},
		},
		usingTimeout: {
			gwta: `using timeout of {timeout: ${DOMAIN_NUMBER}}ms`,
			action: async ({ timeout }: { timeout: number }) => {
				await wp.withPage((page: Page) => {
					page.setDefaultTimeout(timeout);
					page.setDefaultNavigationTimeout(timeout);
				});
				return OK;
			},
		},
	}) as const satisfies TStepperSteps;
