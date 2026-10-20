/**
 * The browser's steps: navigating pages, clicking elements, filling forms, reading pages, capturing screenshots, making
 * requests inside the page, and reaching a browser a person attached through the relay. Each step reads its input and
 * calls a pipeline over the session's page; the cycles start and end a feature's session.
 */
import {
	AStepper,
	CycleWhen,
	READING,
	StepperKinds,
	type IHasCycles,
	type IHasOptions,
	type IStepperCycles,
	type TFeatureStep,
	type TStepperSteps,
} from "@haibun/core/lib/astepper.js";
import { readAction } from "@haibun/core/lib/domains/actions.js";
import { stepInFlight } from "@haibun/core/lib/domains/capability-context.js";
import { basicAuthorization } from "@haibun/core/lib/domains/basic-auth.js";
import {
	DOMAIN_BEARER_TOKEN,
	DOMAIN_FILE_PATH,
	DOMAIN_GLOB,
	DOMAIN_JSON,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
	DOMAIN_PASSWORD,
	DOMAIN_STATEMENT,
	DOMAIN_TEXT,
	DOMAIN_USER_NAME,
	DOMAIN_VARIABLE_NAME,
} from "@haibun/core/lib/domains/domains.js";
import { DOMAIN_IMAGE_REFERENCE } from "@haibun/core/lib/domains/media-object.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import {
	actionNotOK,
	actionOKWithProducts,
	boolOrError,
	constructorName,
	errorDetail,
	findStepperFromOptionOrKind,
	getStepperOption,
	intOrError,
	stringOrError,
} from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, Origin, type TActionResult, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import type { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { WEBSERVER } from "@haibun/web-server-hono/domains/web-server.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import type { Page } from "playwright";
import { PAGE_READ, READS_THE_PAGE, WEB_PLAYWRIGHT_ACTIONS } from "./domains/actions.js";
import { DOMAIN_BROWSER_TAB, DOMAIN_BROWSER_TABS, DOMAIN_BROWSER_TAB_TEXT, DOMAIN_RELAY_ATTACHMENT } from "./domains/relay.js";
import {
	DOMAIN_ACCESSIBILITY_SNAPSHOT,
	DOMAIN_BROWSER_EXTENSION,
	DOMAIN_BROWSER_TYPE,
	DOMAIN_COOKIE_NAME,
	DOMAIN_DIALOG_FIELD,
	DOMAIN_FIND_WAY,
	DOMAIN_HTTP_METHOD,
	DOMAIN_HTTP_METHOD_WITH_BODY,
	DOMAIN_HTTP_METHOD_WITHOUT_BODY,
	DOMAIN_JSON_PROPERTY,
	DOMAIN_JSON_RESPONSE_COUNT,
	DOMAIN_KEYBOARD_KEY,
	DOMAIN_MEDIA_TYPE,
	DOMAIN_PAGE_CONTENTS,
	DOMAIN_PAGE_LOCATOR,
	DOMAIN_PAGE_TARGET,
	DOMAIN_PAGE_TEST_ID,
	DOMAIN_PAGE_TEXT,
	DOMAIN_QUERY_PARAMETER,
	DOMAIN_REQUEST_STATE,
	DOMAIN_RESPONSE_LIST,
	DOMAIN_RUNNING_BROWSER_EXTENSION,
	DOMAIN_URL_GLOB,
	DialogSaysSchema,
	REQUEST_STATE,
	WebPlaywrightDomains,
	type TBrowserTypes,
	type TDialogField,
	type TFindWay,
	type TResponseList,
} from "./domains/web-playwright.js";
import { BrowserSession, type TPageAction } from "./pipelines/browser-session.js";
import { connecting, loadedResult, loadingExtension, type TLoadedExtension } from "./pipelines/browser-options.js";
import { expectDownload, receiveDownload } from "./pipelines/downloads.js";
import { runningExtension } from "./pipelines/extension.js";
import { endFeature, writeFeatureArtifact } from "./pipelines/feature-end.js";
import { goBack, goTo, reload, settle } from "./pipelines/navigation.js";
import { HTTP_TRACE_SOURCES } from "./pipelines/observations.js";
import { pageObserver } from "./pipelines/page-observer.js";
import {
	acceptDialogs,
	blur,
	click,
	clickBy,
	enterInto,
	press,
	resizeToScreen,
	resizeWindow,
	routeRequests,
	scrollUpAScreen,
	selectOption,
	setTimeouts,
	typeText,
	uploadFile,
	withinContainer,
} from "./pipelines/page-input.js";
import {
	canvasIsEmpty,
	cookieIs,
	hasTestId,
	isOnPage,
	pageAddress,
	pageContents,
	queryParameter,
	readThePage,
	screenshotOf,
	sees,
	textOf,
	waitForAddress,
	waitForTarget,
	waitUntilGone,
} from "./pipelines/page-reads.js";
import { listTabs, openTab, readTab } from "./pipelines/relay-tabs.js";
import {
	AUTHORIZATION,
	filterResponse,
	logout,
	request,
	requestEachFiltered,
	requestToken,
	responseCount,
	responseLengthIs,
	responsePropertyIs,
	responseTextIs,
	setExtraHTTPHeaders,
	statusIs,
	type TRestContext,
} from "./pipelines/rest.js";
import { captureScreenshot } from "./pipelines/screenshots.js";
import { keepText } from "./pipelines/variables.js";
import type { TBrowserOptions, TBrowserRelay, TTwin } from "./ports.js";
import { browserPorts, serveRelay, type TBrowserPorts } from "./root.js";

export const WEB_PAGE = "webpage";
const HTTP = "HTTP";
/** The steps that act on what an accessibility snapshot reads, which the snapshot links. */
const SNAPSHOT_ACTIONS = ["click", "clickBy", "setValue", "press", "selectionOption", "gotoPage", "goBack", "takeScreenshot"] as const;
/** What an action names as the read of the page it changed. */
const ANSWERED_BY_THE_PAGE = { answeredBy: READS_THE_PAGE };
/** The arguments that open the browser's devtools on its network panel, where the DEVTOOLS option is set. */
const DEVTOOLS_ARGS = ["--auto-open-devtools-for-tabs", "--devtools-flags=panel-network", "--remote-debugging-port=9223"];
const ARGS_SEPARATOR = ";";
/** A click that ignores whether its target is visible and takes the click. */
const FORCED_CLICK = /^click invisible| with force$/;

/** What a dialog kept in a variable holds in `field`. A variable that doesn't keep a record doesn't keep a dialog. */
const dialogSays = (kept: unknown, field: TDialogField) => (typeof kept === "object" && kept !== null ? DialogSaysSchema.parse(kept)[field] : undefined);

export class WebPlaywright extends AStepper implements IHasOptions, IHasCycles {
	static PERSISTENT_DIRECTORY = "PERSISTENT_DIRECTORY";
	description = "Navigate pages, click elements, fill forms, capture screenshots, and make REST API calls";
	cyclesWhen = { startExecution: CycleWhen.FIRST - 1, startFeature: CycleWhen.FIRST - 1 };
	options = {
		TWIN: { desc: "copy each element a step locates into a twin page", parse: (input: string) => boolOrError(input) },
		HEADLESS: { desc: "run browsers without a window (true, false)", parse: (input: string) => boolOrError(input) },
		CHANNEL: {
			desc: "the browser channel to launch, as chromium for Chromium's full browser without a window, which shows a PDF where the headless shell downloads it",
			parse: (input: string) => stringOrError(input),
		},
		DEVTOOLS: { desc: "show browser devtools (true or false)", parse: (input: string) => boolOrError(input) },
		[WebPlaywright.PERSISTENT_DIRECTORY]: { desc: "the directory of a launched browser's profile, kept across runs", parse: (input: string) => stringOrError(input) },
		ARGS: { desc: "the browser's arguments, separated by semicolons", parse: (input: string) => stringOrError(input) },
		CAPTURE_VIDEO: { desc: "capture video for every agent", parse: (input: string) => boolOrError(input), dependsOn: [StepperKinds.STORAGE] },
		TIMEOUT: { desc: "browser timeout for each step, in milliseconds (unset, Playwright's)", parse: (input: string) => intOrError(input) },
		[StepperKinds.STORAGE]: { desc: "Storage for output", parse: (input: string) => stringOrError(input) },
	};
	captureVideo = false;
	twin = false;
	headless = true;
	#storage: AStorage | undefined;
	#options: TBrowserOptions | undefined;
	#ports: TBrowserPorts | undefined;
	#session: BrowserSession | undefined;
	/** The relay a person's browser attaches through, where actuality serves one. */
	#relay: TBrowserRelay | undefined;
	/** The extension the launched browser loads, and what its manifest declares it runs. */
	#extension: TLoadedExtension | undefined;
	#twinPage: TTwin | undefined;

	get storage(): AStorage {
		return this.madeWithWorld(this.#storage, "storage");
	}
	get session(): BrowserSession {
		return this.madeWithWorld(this.#session, "browser session");
	}
	get #browserOptions(): TBrowserOptions {
		return this.madeWithWorld(this.#options, "browser options");
	}
	get #browser(): TBrowserPorts {
		return this.madeWithWorld(this.#ports, "browser ports");
	}
	get #rest(): TRestContext {
		return { session: this.session, world: this.getWorld(), fetch: this.#browser.fetch };
	}

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const option = (name: string): string | undefined => getStepperOption(this, name, world.moduleOptions);
		this.#storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		this.headless = option("HEADLESS") !== "false";
		this.twin = option("TWIN") === "true";
		this.captureVideo = option("CAPTURE_VIDEO") === "true";
		const devtools = option("DEVTOOLS") === "true";
		const given = option("ARGS");
		const args = [...(given === undefined ? [] : given.split(ARGS_SEPARATOR).filter((arg) => arg !== "")), ...(devtools ? DEVTOOLS_ARGS : [])];
		const channel = option("CHANNEL");
		const timeout = option("TIMEOUT");
		const persistentDirectory = option(WebPlaywright.PERSISTENT_DIRECTORY);
		this.#options = {
			options: this.captureVideo ? { recordVideo: { dir: await this.storage.ensureCaptureLocation(world, "video") } } : {},
			browserType: "chromium",
			launchOptions: { headless: this.headless, devtools, args, ...(channel === undefined ? {} : { channel }) },
			...(timeout === undefined ? {} : { defaultTimeout: Number(timeout) }),
			...(persistentDirectory === undefined ? {} : { persistentDirectory }),
		};
		this.#ports = browserPorts(
			world,
			() => this.#browserOptions,
			(pageKey) => pageObserver(world, pageKey),
		);
		this.#session = new BrowserSession({
			world,
			openPages: () => this.#browser.openPages(),
			captureVideo: this.captureVideo,
			relayed: () => this.#relay !== undefined,
			twin: () => this.#twinPage,
		});
	}

	/** The current tab's page. */
	getPage(): Promise<Page> {
		return this.session.page();
	}

	/** Runs one action on the page, after any action another caller is running on it. */
	withPage<TReturn>(action: TPageAction<TReturn>): Promise<TReturn> {
		return this.session.withPage(action);
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: WebPlaywrightDomains, sources: HTTP_TRACE_SOURCES }),
		onFailure: async ({ failedStep }) => {
			if (failedStep === undefined || !this.session.hasPage(this.session.tab)) return;
			await captureScreenshot(this.session, this.getWorld(), this.storage, "failure", failedStep).catch((e: unknown) =>
				this.getWorld().eventLogger.debug(`the failure screenshot wasn't captured: ${errorDetail(e)}`),
			);
		},
		beforeStep: () => {
			this.session.beforeStep();
			return Promise.resolve();
		},
		afterStep: async ({ featureStep }) => {
			await this.session.releaseAfter(stepInFlight());
			// A page error fails the step that acted on the page, never another stepper's step dispatched meanwhile.
			if (featureStep.action.stepperName !== constructorName(this)) return {};
			const thrown = this.session.stepErrors();
			if (thrown.length === 0) return {};
			// The page's uncaught exception during this step fails it with its cause, before a later wait times out without one.
			const failed = `uncaught browser error during step: ${thrown.join(" | ")}`;
			this.getWorld().eventLogger.log(featureStep, "error", failed);
			return { failed };
		},
		startExecution: async () => {
			if (this.twin) this.#twinPage = await this.#browser.twin(this.storage, this.headless);
		},
		startFeature: async ({ resolvedFeature, index }) => {
			this.session.startFeature();
			await writeFeatureArtifact(this.storage, index, resolvedFeature);
		},
		endFeature: async ({ shouldClose }) => {
			// A failed or last feature leaves its browser open.
			if (shouldClose) await endFeature({ session: this.session, world: this.getWorld(), storage: this.storage, files: this.#browser.files, captureVideo: this.captureVideo });
			if (this.#twinPage) await this.#twinPage.writePage();
		},
	};

	/** Drives a running browser from the next page actuality opens, instead of launching one. */
	#connectTo(cdp: NonNullable<TBrowserOptions["cdp"]>): TActionResult {
		const named = typeof cdp === "string" ? cdp : "the attached browser";
		if (this.session.hasPage(this.session.tab)) return actionNotOK(`connect to a browser before any step opens a page; ${named} was named after one`);
		const options = this.#browserOptions;
		const connected = connecting(options, cdp, { CAPTURE_VIDEO: this.captureVideo, TWIN: this.twin, PERSISTENT_DIRECTORY: options.persistentDirectory !== undefined });
		if ("refusal" in connected) return actionNotOK(connected.refusal);
		this.#options = connected.options;
		return OK;
	}

	/** Runs `use` with the relay a person's browser attaches through, or refuses where actuality doesn't serve one. */
	#withRelay(use: (relay: TBrowserRelay) => Promise<TActionResult>): Promise<TActionResult> {
		return this.#relay === undefined ? Promise.resolve(actionNotOK("the browser relay is not served: `serve the browser relay` serves it")) : use(this.#relay);
	}

	readonly typedSteps = {
		// INPUT
		press: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `press {key: ${DOMAIN_KEYBOARD_KEY}}`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ key }: { key: string }) => press(this.session, key),
		},
		type: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `type {text: ${DOMAIN_TEXT}}`,
			action: async ({ text }: { text: string }) => {
				await typeText(this.session, text);
				return OK;
			},
		},
		setValue: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `enter {what: ${DOMAIN_TEXT}} into {field: ${DOMAIN_PAGE_TARGET}}`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ what, field }: { what: string; field: TStepValue }) => enterInto(this.session, what, field),
		},
		scrollUpAScreen: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `scroll {target: ${DOMAIN_PAGE_TARGET}} up a screen`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ target }: { target: TStepValue }) => scrollUpAScreen(this.session, target),
		},
		selectionOption: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `select {option: ${DOMAIN_PAGE_TEXT}} for {field: ${DOMAIN_PAGE_TARGET}}`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ option, field }: { option: string; field: TStepValue }) => selectOption(this.session, option, field),
		},
		dialogIs: {
			...PAGE_READ,
			gwta: `dialog {what: ${DOMAIN_VARIABLE_NAME}} {type: ${DOMAIN_DIALOG_FIELD}} says {value: ${DOMAIN_TEXT}}`,
			action: async ({ what, type, value }: { what: string; type: TDialogField; value: string }) => {
				const said = dialogSays(await this.getWorld().shared.get(what, true), type);
				return said === value ? OK : actionNotOK(`${what} is ${said}`);
			},
		},
		dialogIsUnset: {
			...PAGE_READ,
			gwta: `dialog {what: ${DOMAIN_VARIABLE_NAME}} {type: ${DOMAIN_DIALOG_FIELD}} not set`,
			action: async ({ what, type }: { what: string; type: TDialogField }) => {
				const said = dialogSays(await this.getWorld().shared.get(what, true), type);
				return said ? actionNotOK(`${what} is ${said}`) : OK;
			},
		},
		shouldSeeTestId: { ...PAGE_READ, gwta: `has test id {testId: ${DOMAIN_PAGE_TEST_ID}}`, action: ({ testId }: { testId: string }) => hasTestId(this.session, testId) },
		seeText: { ...PAGE_READ, gwta: `see {text: ${DOMAIN_TEXT}}`, action: ({ text }: { text: string }) => sees(this.session, text, "body") },
		waitFor: { gwta: `wait for {target: ${DOMAIN_PAGE_TARGET}}`, action: ({ target }: { target: TStepValue }) => waitForTarget(this.session, target) },
		waitUntilGone: { gwta: `wait until {target: ${DOMAIN_PAGE_TARGET}} is gone`, action: ({ target }: { target: TStepValue }) => waitUntilGone(this.session, target) },

		// TABS
		onNewTab: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "on a new tab",
			action: () => {
				this.session.newTab();
				return OK;
			},
		},
		currentTabIs: {
			gwta: `current tab is {tab: ${DOMAIN_NUMBER}}`,
			// A check, once: a feature that waits for a tab to open waits through `until`.
			action: ({ tab }: { tab: number }) => (this.session.tab === tab ? OK : actionNotOK(`current tab is ${this.session.tab}, not ${tab}`)),
		},
		onTabX: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `on tab {tab: ${DOMAIN_NUMBER}}`,
			action: ({ tab }: { tab: number }) => {
				this.session.tab = tab;
				return OK;
			},
		},

		// ADDRESS AND COOKIES
		beOnPage: { ...PAGE_READ, gwta: `be on the {name: ${DOMAIN_LINK}} ${WEB_PAGE}`, action: ({ name }: { name: string }) => isOnPage(this.session, name) },
		cookieIs: {
			...PAGE_READ,
			gwta: `cookie {name: ${DOMAIN_COOKIE_NAME}} is {value: ${DOMAIN_TEXT}}`,
			action: ({ name, value }: { name: string; value: string }) => cookieIs(this.session, this.getWorld().tag.featureNum, name, value),
		},
		waitForURIMatch: {
			...PAGE_READ,
			gwta: `wait until URI matches {pattern: ${DOMAIN_GLOB}}`,
			action: ({ pattern }: { pattern: string }) => waitForAddress(this.session, pattern),
		},
		saveURI: {
			...PAGE_READ,
			gwta: `save URI to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ where }: { where: string }, featureStep: TFeatureStep) => keepText(this.getWorld(), where, await pageAddress(this.session), featureStep),
		},
		saveURIQueryParameter: {
			...PAGE_READ,
			gwta: `save URI query parameter {what: ${DOMAIN_QUERY_PARAMETER}} to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ what, where }: { what: string; where: string }, featureStep: TFeatureStep) =>
				keepText(this.getWorld(), where, await queryParameter(this.session, what), featureStep),
		},

		// CLICK
		click: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `click( invisible)? {target: ${DOMAIN_PAGE_TARGET}}( with force)?`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ target }: { target: TStepValue }, featureStep: TFeatureStep) => click(this.session, target, FORCED_CLICK.test(featureStep.in)),
		},
		inElement: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `in {container: ${DOMAIN_PAGE_LOCATOR}}, {what: ${DOMAIN_STATEMENT}}`,
			description: "Proves the statement within the element the locator finds, or within the document it shows where it is an iframe.",
			reading: READING.within,
			context: ({ container }) => Promise.resolve(<T>(run: () => Promise<T>) => withinContainer(this.session, String(container), run)),
		},
		clickBy: {
			precludes: [`${constructorName(this)}.click`],
			gwta: `click {target: ${DOMAIN_PAGE_TARGET}} by {method: ${DOMAIN_FIND_WAY}}`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ target, method }: { target: TStepValue; method: TFindWay }) => clickBy(this.session, String(target.value), method),
		},

		// NAVIGATION
		gotoPage: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `go to the {name: ${DOMAIN_LINK}} ${WEB_PAGE}`,
			...ANSWERED_BY_THE_PAGE,
			action: ({ name }: { name: string }) => goTo(this.session, name),
		},
		pageHasSettled: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "page has settled",
			action: async () => {
				await settle(this.session);
				return OK;
			},
		},
		reloadPage: { capability: WEB_PLAYWRIGHT_ACTIONS.act, gwta: "reload page", action: () => reload(this.session) },
		goBack: { capability: WEB_PLAYWRIGHT_ACTIONS.act, gwta: "go back", ...ANSWERED_BY_THE_PAGE, action: () => goBack(this.session) },
		blur: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `blur {what: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ what }: { what: TStepValue }) => {
				await blur(this.session, what);
				return OK;
			},
		},

		// BROWSER
		usingBrowserVar: {
			gwta: `using {browser: ${DOMAIN_BROWSER_TYPE}} browser`,
			action: ({ browser }: { browser: TBrowserTypes }) => {
				this.#options = { ...this.#browserOptions, browserType: browser };
				return OK;
			},
		},
		connectToBrowser: {
			gwta: `connect to the browser at {endpoint: ${DOMAIN_LINK}}`,
			description:
				"Drives a running browser through its Chrome DevTools Protocol endpoint instead of launching one. Tab 0 is the one page the browser's own context holds open. Actuality never closes that page or that context, and leaves their dialogs to the browser's owner.",
			action: ({ endpoint }: { endpoint: string }) => this.#connectTo(endpoint),
		},
		loadBrowserExtension: {
			gwta: `load the browser extension at {where: ${DOMAIN_FILE_PATH}}`,
			description:
				"Loads the unpacked extension in the directory `where` into the browser actuality launches, from the next page it opens, and returns the extension's id and origin, derived from the key its manifest pins, so a step can open its pages.",
			productsDomain: DOMAIN_BROWSER_EXTENSION,
			action: ({ where }: { where: string }) => {
				if (this.session.hasPage(this.session.tab)) return actionNotOK(`load an extension before any step opens a page; ${where} was named after one`);
				const loading = loadingExtension(this.#browser.files, this.#browserOptions, where);
				if (!("refusal" in loading)) {
					this.#options = loading.options;
					this.#extension = loading.loaded;
				}
				return loadedResult(loading);
			},
		},
		showBrowserExtension: {
			read: true,
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: "show the browser extension",
			description:
				"Returns the extension the browser runs: its worker, once it has started, and the side panel its toolbar button opens, as the worker reads it. A worker that doesn't start fails the step.",
			productsDomain: DOMAIN_RUNNING_BROWSER_EXTENSION,
			action: () => runningExtension(this.session, this.#extension),
		},
		showBrowserRelay: {
			// The person who attached a browser, and their tabs, are theirs alone, so the read is private.
			read: true,
			capability: readAction(Access.private),
			gwta: "show the browser relay",
			description: "Whether a person's browser is attached through the relay, the key that attached it, and its tabs, each with whether actuality drives it.",
			productsDomain: DOMAIN_RELAY_ATTACHMENT,
			action: () => this.#withRelay((relay) => Promise.resolve(actionOKWithProducts(relay.attachment()))),
		},
		listBrowserTabs: {
			read: true,
			capability: WEB_PLAYWRIGHT_ACTIONS.listTabs,
			readsAt: Access.private,
			gwta: "list the attached browser's tabs",
			description: "Every tab open in the browser a person attached through the relay, attached or not: its id, title and address.",
			productsDomain: DOMAIN_BROWSER_TABS,
			action: () => this.#withRelay(async (relay) => actionOKWithProducts(await listTabs(relay))),
		},
		readBrowserTab: {
			read: true,
			capability: WEB_PLAYWRIGHT_ACTIONS.readTab,
			readsAt: Access.private,
			gwta: `read the attached browser's tab {tabId: ${DOMAIN_NUMBER}}`,
			description:
				"The title, address and text of the page a tab of the attached browser shows, read by the extension without the debugger, so Chrome doesn't show its debugging infobar.",
			productsDomain: DOMAIN_BROWSER_TAB_TEXT,
			action: ({ tabId }: { tabId: number }) => this.#withRelay(async (relay) => actionOKWithProducts(await readTab(relay, tabId))),
		},
		openBrowserTab: {
			capability: WEB_PLAYWRIGHT_ACTIONS.openTab,
			gwta: `open a tab in the attached browser at {url: ${DOMAIN_LINK}}`,
			description: "Opens a tab in the browser a person attached through the relay, where actuality's steps may then act as they act in the tab the person attached.",
			productsDomain: DOMAIN_BROWSER_TAB,
			action: ({ url }: { url: string }) => this.#withRelay(async (relay) => actionOKWithProducts(await openTab(relay, url))),
		},
		closeBrowserTab: {
			capability: WEB_PLAYWRIGHT_ACTIONS.closeTab,
			gwta: `close the attached browser's tab {tabId: ${DOMAIN_NUMBER}}`,
			description: "Closes a tab of the browser a person attached through the relay. Closing the last tab the relay may act in ends the attachment.",
			action: ({ tabId }: { tabId: number }) => this.#withRelay((relay) => relay.closeTab(tabId).then(() => OK)),
		},
		serveBrowserRelay: {
			gwta: "serve the browser relay",
			description:
				"Serves the relay a person's extension attaches their browser through, over `/rpc` as `relay.attach` and `relay.send`, which require `WebPlaywright:attach`, and drives that browser from the next page actuality opens. Actuality never closes the attached browser's pages or context. A step that needs the browser is refused while a browser isn't attached, and the refusal states so.",
			action: () => {
				const world = this.getWorld();
				const webserver = world.runtime[WEBSERVER] as IWebServer | undefined;
				if (webserver === undefined) return actionNotOK("the browser relay is served by the web server, and a web server isn't running: start one before serving the relay");
				const relay = serveRelay(webserver, WEB_PLAYWRIGHT_ACTIONS.attach, (error) => world.eventLogger.error(`browser relay: ${errorDetail(error)}`));
				this.#relay = relay;
				return this.#connectTo(() => relay.transport());
			},
		},

		// FILES
		uploadFile: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `upload file {file: ${DOMAIN_FILE_PATH}} using {selector: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ file, selector }: { file: string; selector: TStepValue }) => {
				await uploadFile(this.session, file, selector);
				return OK;
			},
		},
		expectDownload: { capability: WEB_PLAYWRIGHT_ACTIONS.act, gwta: "expect a download", action: () => expectDownload(this.session) },
		receiveDownload: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `receive download as {file: ${DOMAIN_FILE_PATH}}`,
			action: ({ file }: { file: string }) => receiveDownload(this.session, file),
		},

		// DIALOGS, CANVAS, SCREENSHOTS AND CONTENTS
		captureDialog: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `accept next dialog to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ where }: { where: string }, featureStep: TFeatureStep) => {
				const { shared, eventLogger } = this.getWorld();
				// A dialog's listener doesn't wait, so the dialog is kept in the background.
				await acceptDialogs(
					this.session,
					(said) => void shared.setJSON(where, said, Origin.var, featureStep).catch((e: unknown) => eventLogger.error(`keeping the dialog in ${where} failed: ${errorDetail(e)}`)),
				);
				return OK;
			},
		},
		canvasIsEmpty: { gwta: `canvas {what: ${DOMAIN_PAGE_LOCATOR}} is empty`, action: ({ what }: { what: string }) => canvasIsEmpty(this.session, what) },
		takeScreenshotOf: {
			...PAGE_READ,
			gwta: `take a screenshot of {what: ${DOMAIN_PAGE_TARGET}} to {where: ${DOMAIN_FILE_PATH}}`,
			action: ({ what, where }: { what: TStepValue; where: string }) => screenshotOf(this.session, what, where),
		},
		takeScreenshot: {
			...PAGE_READ,
			gwta: "take a screenshot",
			description: "Screenshots the page into actuality's storage, and returns where the image's bytes are kept and their media type.",
			productsDomain: DOMAIN_IMAGE_REFERENCE,
			action: async (_args: Record<string, never>, featureStep: TFeatureStep) =>
				actionOKWithProducts(
					await captureScreenshot(this.session, this.getWorld(), this.storage, "action", { seqPath: featureStep.seqPath, path: featureStep.source?.path, in: featureStep.in }),
				),
		},
		getPageContents: {
			...PAGE_READ,
			gwta: "get page contents",
			productsDomain: DOMAIN_PAGE_CONTENTS,
			// The page's markup is the action's result; keeping it on the event too can take many megabytes per call.
			retainProducts: false,
			action: async () => actionOKWithProducts({ html: await pageContents(this.session) }),
		},
		takeAccessibilitySnapshot: {
			...PAGE_READ,
			gwta: "take an accessibility snapshot",
			description:
				'Reads the page as Playwright\'s aria snapshot in its AI mode: YAML naming each element\'s role and accessible name, and its reference, such as [ref=e2], which `click "e2" by "reference"` clicks. Its links name the steps that act on what it read, and a caller of each of those receives this read.',
			read: true,
			productsDomain: DOMAIN_ACCESSIBILITY_SNAPSHOT,
			action: async () => actionOKWithProducts(await readThePage(this.session, Object.fromEntries(SNAPSHOT_ACTIONS.map((step) => [step, { method: stepMethodName(this, step) }])))),
		},
		saveTextFrom: {
			...PAGE_READ,
			gwta: `save text from {element: ${DOMAIN_PAGE_TARGET}} to {where: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ element, where }: { element: TStepValue; where: string }, featureStep: TFeatureStep) =>
				keepText(this.getWorld(), where, await textOf(this.session, element), featureStep),
		},
		resizeWindow: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: `resize window to {width: ${DOMAIN_NUMBER}}x{height: ${DOMAIN_NUMBER}}`,
			action: async ({ width, height }: { width: number; height: number }) => {
				await resizeWindow(this.session, width, height);
				return OK;
			},
		},
		resizeAvailable: {
			capability: WEB_PLAYWRIGHT_ACTIONS.act,
			gwta: "resize window to largest dimensions",
			action: async () => {
				await resizeToScreen(this.session);
				return OK;
			},
		},
		requestsMatching: {
			capability: WEB_PLAYWRIGHT_ACTIONS.read,
			gwta: `requests matching {pattern: ${DOMAIN_URL_GLOB}} are {state: ${DOMAIN_REQUEST_STATE}}`,
			description: `Blocks, holds or allows the requests this page makes, by URL glob, for the rest of the feature: what a view does when its server is unreachable, and what it does when the server responds again. ${Object.values(REQUEST_STATE).join(" or ")}.`,
			action: async ({ pattern, state }: { pattern: string; state: string }) => {
				await routeRequests(this.session, pattern, state);
				return OK;
			},
		},
		usingTimeout: {
			gwta: `using timeout of {timeout: ${DOMAIN_NUMBER}}ms`,
			action: async ({ timeout }: { timeout: number }) => {
				await setTimeouts(this.session, timeout);
				return OK;
			},
		},

		// REQUESTS INSIDE THE PAGE
		setApiUserAgent: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `API user agent is {agent: ${DOMAIN_TEXT}}`,
			action: ({ agent }: { agent: string }) => {
				this.session.apiUserAgent = agent;
				return OK;
			},
		},
		addBasicAuthCredentials: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `use Authorization Basic header with {username: ${DOMAIN_USER_NAME}}, {password: ${DOMAIN_PASSWORD}}`,
			action: async ({ username, password }: { username: string; password: string }) => {
				await setExtraHTTPHeaders(this.session, { [AUTHORIZATION]: basicAuthorization({ username, password }) });
				return OK;
			},
		},
		addAuthBearerToken: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `use Authorization Bearer header with {token: ${DOMAIN_BEARER_TOKEN}}`,
			action: async ({ token }: { token: string }) => {
				await setExtraHTTPHeaders(this.session, { [AUTHORIZATION]: `Bearer ${token}` });
				return OK;
			},
		},
		restTokenRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `request OAuth 2.0 access token from {endpoint: ${DOMAIN_LINK}}`,
			action: ({ endpoint }: { endpoint: string }, featureStep: TFeatureStep) => requestToken(this.#rest, featureStep, endpoint),
		},
		restTokenLogout: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `perform OAuth 2.0 logout from {endpoint: ${DOMAIN_LINK}}`,
			action: ({ endpoint }: { endpoint: string }, featureStep: TFeatureStep) => logout(this.#rest, featureStep, endpoint),
		},
		acceptEndpointRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `accept {accept: ${DOMAIN_MEDIA_TYPE}} using ${HTTP} {method: ${DOMAIN_HTTP_METHOD_WITHOUT_BODY}} to {endpoint: ${DOMAIN_LINK}}`,
			action: ({ accept, method, endpoint }: { accept: string; method: string; endpoint: string }, featureStep: TFeatureStep) =>
				request(this.#rest, featureStep, endpoint, method, { headers: { accept } }),
		},
		restEndpointRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `make an ${HTTP} {method: ${DOMAIN_HTTP_METHOD}} to {endpoint: ${DOMAIN_LINK}}`,
			action: ({ method, endpoint }: { method: string; endpoint: string }, featureStep: TFeatureStep) => request(this.#rest, featureStep, endpoint, method),
		},
		restEndpointRequestWithPayload: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			precludes: [`${constructorName(this)}.restEndpointRequest`],
			gwta: `make an ${HTTP} {method: ${DOMAIN_HTTP_METHOD_WITH_BODY}} to {endpoint: ${DOMAIN_LINK}} with {payload: ${DOMAIN_JSON}}`,
			action: ({ method, endpoint, payload }: { method: string; endpoint: string; payload: unknown }, featureStep: TFeatureStep) =>
				request(this.#rest, featureStep, endpoint, method, { postData: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),
		},
		filterResponseJson: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `filter JSON response by {property: ${DOMAIN_JSON_PROPERTY}} matching {match: ${DOMAIN_TEXT}}`,
			action: ({ property, match }: { property: string; match: string }, featureStep: TFeatureStep) => filterResponse(this.getWorld(), featureStep, property, match),
		},
		responseLengthIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `{list: ${DOMAIN_RESPONSE_LIST}} response length is {length: ${DOMAIN_NUMBER}}`,
			description: "Whether the last response's JSON list, or the members a filter kept of it, holds the number of members.",
			action: ({ list, length }: { list: TResponseList; length: number }) => responseLengthIs(this.getWorld(), list, length),
		},
		showResponseLength: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: "show JSON response count",
			productsDomain: DOMAIN_JSON_RESPONSE_COUNT,
			action: () => responseCount(this.getWorld()),
		},
		restFilterPropertyRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `for each filtered {property: ${DOMAIN_JSON_PROPERTY}}, make REST {method: ${DOMAIN_HTTP_METHOD_WITHOUT_BODY}} to {endpoint: ${DOMAIN_LINK}} yielding status {status: ${DOMAIN_NUMBER}}`,
			action: ({ property, method, endpoint, status }: { property: string; method: string; endpoint: string; status: number }) =>
				requestEachFiltered(this.#rest, property, method, endpoint, status),
		},
		restLastStatusIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} status is {status: ${DOMAIN_NUMBER}}`,
			action: ({ status }: { status: number }) => statusIs(this.getWorld(), status),
		},
		restResponsePropertyIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} response property {property: ${DOMAIN_JSON_PROPERTY}} is {value: ${DOMAIN_TEXT}}`,
			action: ({ property, value }: { property: string; value: string }) => responsePropertyIs(this.getWorld(), property, value),
		},
		restResponseIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} text response is {value: ${DOMAIN_TEXT}}`,
			action: ({ value }: { value: string }) => responseTextIs(this.getWorld(), value),
		},
	} as const satisfies TStepperSteps;
	steps: TStepperSteps = this.typedSteps;
}

export default WebPlaywright;
