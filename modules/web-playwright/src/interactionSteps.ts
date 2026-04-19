import { Download, Page, Response } from "playwright";
type ClickResult = import("playwright").Locator;

import { TFeatureStep } from "@haibun/core/lib/execution.js";
import { OK, Origin, TActionResult, TStepResult } from "@haibun/core/schema/protocol.js";
import { DOMAIN_STATEMENT, DOMAIN_STRING } from "@haibun/core/lib/domains.js";
import { actionNotOK, actionOKWithProducts, sleep, getStepTerm, jsonArtifact } from "@haibun/core/lib/util/index.js";
import { z } from "zod";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TEST_ID } from "./domains.js";
import { pickLocatorDomain } from "./web-playwright.js";
import { WEB_PAGE, WebPlaywright } from "./web-playwright.js";
import { BROWSERS } from "./BrowserFactory.js";

import { pathToFileURL } from "node:url";
import { TStepperSteps } from "@haibun/core/lib/astepper.js";
import { provenanceFromFeatureStep } from "@haibun/core/steps/variables-stepper.js";
import { FlowRunner } from "@haibun/core/lib/core/flow-runner.js";
import { JsonArtifact } from "@haibun/core/schema/protocol.js";

const DOMAIN_STRING_OR_PAGE_LOCATOR = `${DOMAIN_STRING} | ${DOMAIN_PAGE_LOCATOR}`;

export const interactionSteps = (wp: WebPlaywright) =>
	({
		// INPUT
		press: {
			gwta: "press {key}",
			action: async ({ key }: { key: string }) => {
				await wp.withPage(async (page: Page) => await page.keyboard.press(key));
				return OK;
			},
		},
		type: {
			gwta: "type {text}",
			action: async ({ text }: { text: string }) => {
				await wp.withPage(async (page: Page) => await page.keyboard.type(text));
				return OK;
			},
		},
		inputVariable: {
			gwta: `input {what} for {field: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
			action: async ({ what, field }: { what: string; field: string }, featureStep: TFeatureStep) => {
				await wp.withPage(async (page: Page) => await (await wp.locateByDomain(page, featureStep, "field")).fill(what));
				return OK;
			},
		},
		selectionOption: {
			gwta: `select {option} for {field: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
			action: async ({ option, field }: { option: string; field: string }, featureStep: TFeatureStep) => {
				await wp.withPage(
					async (page: Page) => await (await wp.locateByDomain(page, featureStep, "field")).selectOption({ label: option }),
				);
				return OK;
			},
		},
		dialogIs: {
			gwta: "dialog {what} {type} says {value}",
			action: async ({ what, type, value }: { what: string; type: string; value: string }) => {
				const resolvedValue = await wp.getWorld().shared.get(what, true);
				const cur = (resolvedValue as Record<string, unknown> | undefined)?.[type];
				return cur === value ? OK : actionNotOK(`${what} is ${cur}`);
			},
		},
		dialogIsUnset: {
			gwta: "dialog {what} {type} not set",
			action: async ({ what, type }: { what: string; type: string }) => {
				const resolvedValue = await wp.getWorld().shared.get(what, true);
				const cur = (resolvedValue as Record<string, unknown> | undefined)?.[type];
				return !cur ? OK : actionNotOK(`${what} is ${cur}`);
			},
		},
		shouldSeeTestId: {
			gwta: "has test id {testId}",
			action: async ({ testId }: { testId: string }) => {
				const found = await wp.withPage(async (page: Page) => await page.getByTestId(testId));
				return found ? OK : actionNotOK(`Did not find test id ${testId}`);
			},
		},
		seeText: {
			gwta: "see {text}",
			action: async ({ text }: { text: string }) => await wp.sees(text, "body"),
		},
		waitFor: {
			gwta: `wait for {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
			action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
				try {
					// Check if we're being called from within inElement with a shadow DOM context
					if (wp.inContainerSelector) {
						try {
							// Get the actual Page object (not through withPage which might return a Locator)
							const page = await wp.getPage();
							// Assume the container is a shadow DOM host - wait for element in shadow root
							await page.waitForFunction(
								({ containerSel, innerSel }) => {
									const host = document.querySelector(containerSel);
									if (!host?.shadowRoot) return false;

									const element = host.shadowRoot.querySelector(innerSel);
									if (!element) return false;

									// Use getBoundingClientRect to check if element has dimensions
									const rect = element.getBoundingClientRect();
									if (rect.width === 0 || rect.height === 0) return false;

									// Check computed styles for common hiding methods
									const computed = window.getComputedStyle(element);
									if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") return false;

									// Check if element is behind other layers (negative z-index parent)
									let current = element.parentElement;
									while (current) {
										const style = window.getComputedStyle(current);
										if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
										const zIndex = parseInt(style.zIndex);
										if (!isNaN(zIndex) && zIndex < 0) return false;
										current = current.parentElement;
									}

									return true;
								},
								{ containerSel: wp.inContainerSelector, innerSel: target },
								{ timeout: 30000 },
							);
							return OK;
						} catch (e) {
							// Shadow DOM approach failed, return error
							return actionNotOK(`Did not find ${target} in shadow DOM: ${e}`);
						}
					}

					// Regular wait — use page.waitForFunction to traverse shadow DOMs for dynamic elements
					const { value: resolvedValue, domain: resolvedDomain } = await wp
						.getWorld()
						.shared.resolveVariable(featureStep.action.stepValuesMap.target, featureStep);
					const domainParts = resolvedDomain?.split(" | ").map((d: string) => d.trim()) ?? [];
					const effectiveDomain = domainParts.length === 1 ? domainParts[0] : pickLocatorDomain(domainParts);
					if (effectiveDomain === DOMAIN_PAGE_TEST_ID) {
						await wp.withPage(async (page: Page) =>
							page.waitForFunction(
								(testId) => {
									function walk(root: Document | ShadowRoot): Element | null {
										const el = root.querySelector(`[data-testid="${testId}"]`);
										if (el) return el;
										for (const child of root.querySelectorAll("*")) {
											if (child.shadowRoot) {
												const found = walk(child.shadowRoot);
												if (found) return found;
											}
										}
										return null;
									}
									return walk(document);
								},
								String(resolvedValue),
								{ timeout: 30000 },
							),
						);
					} else {
						await wp.withPage(async (page: Page) => await (await wp.locateByDomain(page, featureStep, "target")).waitFor());
					}
					return OK;
				} catch (_e) {
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
			exposeMCP: false,
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

				console.debug("background", background, browserContext.serviceWorkers());

				const extensionId = background.url().split("/")[2];
				await wp
					.getWorld()
					.shared.set(
						{ term: "extensionContext", value: extensionId, domain: "string", origin: Origin.var },
						provenanceFromFeatureStep(featureStep),
					);
				await wp.withPage(async (page: Page) => {
					const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
					return await page.goto(popupURI);
				});

				return OK;
			},
		},
		cookieIs: {
			gwta: "cookie {name} is {value}",
			action: async ({ name, value }: { name: string; value: string }) => {
				const cookies = await wp.getCookies();
				const found = cookies?.find((c) => c.name === name && c.value === value);
				return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
			},
		},
		URIQueryParameterIs: {
			gwta: "URI query parameter {what} is {value}",
			action: async ({ value }: { value: string }, featureStep) => {
				const term = getStepTerm(featureStep, "what") ?? "";
				const uri = await wp.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(term);
				if (found === value) {
					return OK;
				}
				return actionNotOK(`URI query ${term} contains "${found}", not "${value}"`);
			},
		},

		//                  CLICK
		click: {
			gwta: `click( invisible)? {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}( with force)?`,
			action: async ({ target }: { target: string }, featureStep) => {
				const forced = featureStep.in.match(/ with force$/) || featureStep.in.match(/^click invisible/) ? { force: true } : {};
				await wp.withPage(async (page: Page) => {
					return await (await wp.locateByDomain(page, featureStep, "target")).click(forced);
				});
				return OK;
			},
		},
		inElement: {
			gwta: `in {container: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}, {what: ${DOMAIN_STATEMENT}}`,
			action: async ({ container, what }: { container: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
				return await wp.withPage(async (page: Page) => {
					// For shadow DOM elements, use page.locator directly to ensure CSS selector is used
					const containerLocator = page.locator(container);
					wp.inContainer = containerLocator;
					wp.inContainerSelector = container; // Store the selector string for shadow DOM detection
					const flowRunner = new FlowRunner(wp.getWorld(), [wp]);
					const flowResult = await flowRunner.runSteps(what, { parentStep: featureStep });
					wp.inContainer = undefined;
					wp.inContainerSelector = undefined;
					if (flowResult.ok) {
						return OK;
					}
					return actionNotOK(flowResult.errorMessage || "inElement flow failed");
				});
			},
		},
		clickBy: {
			precludes: [`${wp.constructor.name}.click`],
			gwta: `click {target: ${DOMAIN_STRING_OR_PAGE_LOCATOR}} by {method}`,
			handlesUndefined: ["method"],
			action: async ({ target }: { target: string; method: string }, featureStep: TFeatureStep) => {
				const method = getStepTerm(featureStep, "method") ?? "";
				let withModifier: Record<string, unknown> = {};

				const bys: Record<string, (page: Page) => ClickResult | Promise<ClickResult> | Promise<void>> = {
					"alt text": (page: Page) => page.getByAltText(target),
					"test id": (page: Page) => page.getByTestId(target),
					placeholder: (page: Page) => page.getByPlaceholder(target),
					role: (page: Page) => page.getByRole(target as Parameters<Page["getByRole"]>[0]),
					label: (page: Page) => page.getByLabel(target),
					title: (page: Page) => page.getByTitle(target),
					text: (page: Page) => page.getByText(target),
					modifier: async (page: Page) => {
						withModifier = JSON.parse(method);
						return await wp.locateByDomain(page, featureStep, "target");
					},
				};
				if (!bys[method]) {
					return actionNotOK(`unknown click by "${method}" from ${Object.keys(bys).toString()} `);
				}
				await wp.withPage(async (page: Page) => {
					const locatorResult = await bys[method](page);
					const maybeLocator = locatorResult as unknown;
					if (typeof maybeLocator === "object" && maybeLocator && "click" in maybeLocator) {
						await (maybeLocator as import("playwright").Locator).click(withModifier);
					}
				});
				return OK;
			},
		},
		//                          NAVIGATION

		gotoPage: {
			gwta: `go to the {name} ${WEB_PAGE}`,
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
			gwta: "page has settled",
			action: async () => {
				await wp.withPage(async (page: Page) => {
					await wp.waitForLoaded(page, "settled");
				});
				return OK;
			},
		},
		reloadPage: {
			gwta: "reload page",
			action: async () => {
				await wp.withPage(async (page: Page) => await page.reload());
				return OK;
			},
		},

		goBack: {
			gwta: "go back",
			action: async () => {
				await wp.withPage(async (page: Page) => await page.goBack());
				return OK;
			},
		},

		blur: {
			gwta: `blur {what: ${DOMAIN_STRING_OR_PAGE_LOCATOR}}`,
			action: async ({ what }: { what: string }, featureStep: TFeatureStep) => {
				await wp.withPage(
					async (page: Page) => await (await wp.locateByDomain(page, featureStep, "what")).evaluate((e) => e.blur()),
				);
				return OK;
			},
		},

		//                         BROWSER
		usingBrowserVar: {
			gwta: "using {browser} browser",
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
				await wp.withPage(async (page: Page) => await (await wp.locateByDomain(page, featureStep, "selector")).setInputFiles(file));
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
							page.waitForEvent("filechooser"),
							(await wp.locateByDomain(page, featureStep, "selector")).click(),
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
			gwta: "expect a download",
			action: () => {
				try {
					wp.expectedDownload = wp.withPage<Download>(async (page: Page) => page.waitForEvent("download"));
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		receiveDownload: {
			gwta: "receive download as {file}",
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
			gwta: "save download to {file}",
			action: async ({ file }: { file: string }) => {
				try {
					const download = <Download>await wp.withPage(async (page: Page) => page.waitForEvent("download"));

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
			gwta: "accept next dialog to {where}",
			action: async ({ where }: { where: string }, featureStep) => {
				await wp.withPage((page: Page) => {
					return page.on("dialog", async (dialog) => {
						const res = {
							defaultValue: dialog.defaultValue(),
							message: dialog.message(),
							type: dialog.type(),
						};
						await dialog.accept();
						if (!where) {
							console.error('Error: captureDialog called with empty "where" argument');
							return;
						}
						// fire-and-forget: sync dialog callback cannot await; in-memory QuadStore resolves synchronously
						void wp.getWorld().shared.setJSON(where, res, Origin.var, featureStep);
					});
				});
				return OK;
			},
		},
		canvasIsEmpty: {
			gwta: "canvas {what} is empty",
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
			gwta: `take a screenshot of {what: ${DOMAIN_STRING_OR_PAGE_LOCATOR}} to {where}`,
			action: async ({ what, where }: { what: string; where: string }, featureStep: TFeatureStep) => {
				try {
					await wp.withPage(async (page: Page) => {
						const locator = await wp.locateByDomain(page, featureStep, "what");
						if ((await locator.count()) !== 1) {
							throw Error(`no single ${what} from ${locator} `);
						}
						await locator.screenshot({ path: where });
						wp.getWorld().eventLogger.info(`screenshot of ${what} saved to ${pathToFileURL(where)} `);
					});
					return OK;
				} catch (e) {
					return actionNotOK(e);
				}
			},
		},
		takeScreenshot: {
			gwta: "take a screenshot",
			action: async (_args, featureStep: TFeatureStep) => {
				// Create a minimal step result for artifact tracking
				const stepResult = featureStep
					? { seqPath: featureStep.seqPath, path: featureStep.source.path, in: featureStep.in }
					: undefined;
				await wp.captureScreenshotAndLog("action", { step: stepResult as unknown as TStepResult | undefined });
				return OK;
			},
		},
		getPageContents: {
			gwta: "get page contents",
			outputSchema: z.object({ html: z.string() }),
			action: async () => {
				const contents = await wp.withPage<string>(async (page: Page) => await page.content());
				return actionOKWithProducts({ html: contents || "" });
			},
		},
		takeAccessibilitySnapshot: {
			gwta: "take an accessibility snapshot",
			action: async () => {
				const snapshot = await wp.captureAccessibilitySnapshot();

				// Emit JsonArtifact
				if (wp.getWorld().eventLogger) {
					const artifactEvent = JsonArtifact.parse({
						id: `a11y-snapshot-${Date.now()}`,
						timestamp: Date.now(),
						kind: "artifact",
						artifactType: "json",
						json: (snapshot as Record<string, unknown>) || {},
						mimetype: "application/json",
					});
					// We don't have featureStep here?
					// The action has featureStep in signature if we added it.
					// But we can use emit() directly or ignore featureStep association if not critical.
					// Better: add featureStep to action signature. But typings?
					wp.getWorld().eventLogger.emit(artifactEvent);
				}

				wp.getWorld().eventLogger.info("Accessibility snapshot captured");
				return OK;
			},
		},
		saveURIQueryParameter: {
			gwta: "save URI query parameter {what} to {where}",
			handlesUndefined: ["what", "where"],
			action: async (_args: Record<string, unknown>, featureStep) => {
				const what = getStepTerm(featureStep, "what") ?? "";
				const where = getStepTerm(featureStep, "where") ?? "";
				const uri = await wp.withPage<string>(async (page: Page) => await page.url());
				const found = new URL(uri).searchParams.get(what);
				await wp
					.getWorld()
					.shared.set({ term: where, value: found, domain: "string", origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return OK;
			},
		},
		saveTextFrom: {
			gwta: `save text from {element: ${DOMAIN_STRING_OR_PAGE_LOCATOR}} to {where}`,
			handlesUndefined: ["where"],
			action: async (_args: Record<string, unknown>, featureStep) => {
				const where = getStepTerm(featureStep, "where") ?? "";
				const text = await wp.withPage<string>(async (page: Page) => {
					const locator = await wp.locateByDomain(page, featureStep, "element");
					const content = await locator.textContent();
					if (content !== null && content.trim() !== "") {
						return content.trim();
					}
					return await locator.inputValue();
				});
				await wp
					.getWorld()
					.shared.set({ term: where, value: text, domain: "string", origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return OK;
			},
		},
		resizeWindow: {
			gwta: "resize window to {width}x{height}",
			action: async ({ width, height }: { width: string; height: string }) => {
				await wp.withPage(async (page: Page) => await page.setViewportSize({ width: parseInt(width), height: parseInt(height) }));
				return OK;
			},
		},
		resizeAvailable: {
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
		usingTimeout: {
			gwta: "using timeout of {timeout}ms",
			action: async ({ timeout }: { timeout: string }) => {
				const timeoutMs = parseInt(timeout, 10);
				await wp.withPage((page: Page) => {
					page.setDefaultTimeout(timeoutMs);
					page.setDefaultNavigationTimeout(timeoutMs);
				});
				return OK;
			},
		},
	}) as const satisfies TStepperSteps;
