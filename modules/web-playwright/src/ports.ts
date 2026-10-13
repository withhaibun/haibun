/**
 * The ports of the browser's pipelines: the pages a feature drives, the observer of a page's traffic, the twin that copies
 * what a step locates, the files a step reads and leaves, and the relay of a person's attached browser. The chrome.* shapes
 * the relay and the extension exchange are structural copies of `@types/chrome`'s, as Playwright 7b4b3b0828's
 * `packages/playwright-core/src/tools/mcp/protocol.ts` states them.
 */
import type { BrowserContext, BrowserContextOptions, ConnectOverCDPTransport, Page } from "playwright";
import type { TBrowserTypes, TCapturedResponse } from "./domains/web-playwright.js";
import type { TRelayAttachment } from "./domains/relay.js";

/** A debugger's target: a tab, an extension or a target. */
export type Debuggee = { tabId?: number; extensionId?: string; targetId?: string };
/** A debugger's target with the CDP session of a message. */
export type DebuggerSession = Debuggee & { sessionId?: string };
export type Tab = { id?: number; index: number; windowId: number; openerTabId?: number; url?: string; title?: string; active: boolean; pinned: boolean };
export type TabRemoveInfo = { windowId: number; isWindowClosing: boolean };

/** The chrome events the extension forwards to the relay, each with the positional parameters of its listener. */
export type TChromeEvents = {
	"chrome.debugger.onEvent": { params: [source: DebuggerSession, method: string, eventParams?: object] };
	"chrome.debugger.onDetach": { params: [source: Debuggee, reason: string] };
	"chrome.tabs.onCreated": { params: [tab: Tab] };
	"chrome.tabs.onRemoved": { params: [tabId: number, removeInfo: TabRemoveInfo] };
	/** The end of the extension's first report of its tabs: the relay holds Playwright's CDP until it arrives, so
	 *  `Target.setAutoAttach` reads a full tab model. */
	"extension.initialized": { params: [] };
};

/** How actuality obtains its browser: the context options, the profile a persistent context keeps (empty for one Playwright
 *  makes and removes), the browser to launch and its launch options, each step's timeout where it isn't Playwright's, the
 *  device to emulate, and a running browser to connect to in place of a launch: its CDP endpoint, or the transport to
 *  drive it in this process. */
export type TBrowserOptions = {
	options: BrowserContextOptions;
	persistentDirectory?: string;
	browserType: TBrowserTypes;
	launchOptions: { headless: boolean; devtools: boolean; args: string[]; channel?: string };
	defaultTimeout?: number;
	device?: string;
	cdp?: string | (() => ConnectOverCDPTransport);
};

/** What actuality holds of a browser, a context or a page: one it opened, one it adopted from a connected browser's owner,
 *  or one closed. Actuality closes, traces, binds errors to and handles dialogs on only what it opened. */
export type THolding = { opened(): void; adopted(): void; closed(): void; owned(): boolean };

/** The pages of a feature, by tab: the browser it launches or connects to, its context, and each tab's page. */
export type TBrowserPages = {
	hasPage(featureNum: number, tab: number): boolean;
	page(featureNum: number, tab: number): Promise<Page>;
	/** A page another page opened, held as the tab it became. */
	registerPopup(featureNum: number, tab: number, popup: Page): void;
	/** Whether the page is the owner's of a connected browser rather than one actuality opened. */
	isAdopted(page: Page): boolean;
	context(featureNum: number): BrowserContext | undefined;
	closeContext(featureNum: number): Promise<void>;
	/** Lets go of a connected browser, leaving it running. */
	disconnect(): Promise<void>;
	close(): Promise<void>;
};

/** A request a page made, as its observer reads it, with the frame that made it and the address of its page. */
export type TPageRequest = { url: string; method: string; headers: Record<string, string>; postData?: string; frameUrl: string; pageUrl: string };
/** A response a page received, with its request's method and body, and how long the exchange took. */
export type TPageResponse = TPageRequest & { status: number; statusText: string; durationMs: number };
/** The observer of a page's traffic: each request, each response, and each navigation of its main frame. */
export type TPageObserver = { request(request: TPageRequest): void; response(response: TPageResponse): void; navigated(url: string): void };

/** The twin of actuality's pages: a page in a browser of its own, which copies each element a step locates. */
export type TTwin = { patchPage(page: Page): Promise<void>; writePage(): Promise<void> };

/** The files a step reads and leaves: a path resolved from the working directory, the manifest a directory holds (undefined
 *  where it lacks one), and a download removed. */
export type TFiles = { resolve(where: string): string; manifest(directory: string): unknown; remove(file: string): void };

/** The relay of a person's attached browser: what it holds, the attached browser's tabs, and the transport of Playwright's CDP. */
export type TBrowserRelay = {
	attachment(): TRelayAttachment;
	listTabs(): Promise<Tab[]>;
	readTab(tabId: number): Promise<unknown>;
	openTab(url: string): Promise<Tab>;
	closeTab(tabId: number): Promise<void>;
	transport(): ConnectOverCDPTransport;
};

/** A request made with `fetch` inside the page: its endpoint, its method, its headers and its body. */
export type TFetchRequest = { endpoint: string; method: string; headers: Record<string, string>; postData?: string };
/** Makes a request inside the page, so it carries the page's cookies, and returns its response. */
export type TPageFetch = (page: Page, request: TFetchRequest) => Promise<TCapturedResponse>;

/** What the browser's adapters log. */
export type TBrowserLog = { debug(message: string): void; error(message: string): void };
