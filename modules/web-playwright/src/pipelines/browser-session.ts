/**
 * A feature's session with the browser: the tab its steps act in, the page each tab shows, one action at a time on a
 * page, the tab in front, the container a step scopes its finds to, the errors the page threw during a step, and the
 * pages a relayed browser drives until the outermost step that drove them ends.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Download, Locator, Page } from "playwright";
import type { TFeatureStep, TStepAction } from "@haibun/core/lib/astepper.js";
import { stepInFlight } from "@haibun/core/lib/capability-context.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { VideoStartArtifact } from "@haibun/core/schema/protocol.js";
import type { TBrowserPages, TTwin } from "../ports.js";

/** Where a step finds elements: within the container `in {container}, {what}` names, or on the page. */
export type TPageScope = Page | Locator;
/** An action on the page. */
export type TPageAction<TReturn> = (page: Page) => TReturn | Promise<TReturn>;

/** The step a feature's own artifact is recorded on: the feature's first position. */
export const featureStepOf = (featureNum: number, label: string): TFeatureStep => ({ seqPath: [featureNum, 0, 0], in: label, action: {} as TStepAction });

export type TSessionContext = {
	world: TWorld;
	/** The pages of a feature, made where the session opens its first page in it. */
	openPages: () => TBrowserPages;
	captureVideo: boolean;
	/** Whether a relay drives the browser: its pages are let go once the outermost step that drove them ends. */
	relayed: () => boolean;
	/** The twin that copies what a step locates, where actuality keeps one. */
	twin: () => TTwin | undefined;
};

export class BrowserSession {
	/** The tab of the current step's actions. */
	tab = 0;
	/** The container `in {container}, {what}` scopes its statement's finds to, while it runs. */
	inContainer: Locator | undefined;
	/** The uncaught errors the page threw since the feature started. A step during which one is thrown fails. */
	browserErrors: string[] = [];
	/** How many errors were thrown before the current step. */
	errorMark = 0;
	extraHTTPHeaders: Record<string, string> = {};
	apiUserAgent: string | undefined;
	/** The download a step expects, which the step that receives it saves. */
	expectedDownload: Promise<Download> | undefined;
	/** The files the feature's downloads were saved to, which its end removes. */
	downloaded: string[] = [];
	readonly #context: TSessionContext;
	#pages: TBrowserPages | undefined;
	#videoStartEmitted = false;
	/** The page in front, where a step's action brought it there; undefined once another page may be in front. */
	#front: Page | undefined;
	/** The outermost steps whose calls drove the relayed browser, held until the last of them ends. */
	readonly #drivingFor = new Set<string>();
	readonly #boundPages = new WeakSet<Page>();
	/** The pages the current call chain holds, so an action nested in another doesn't wait behind it. */
	readonly #holding = new AsyncLocalStorage<Set<Page>>();
	/** The last action queued on each page. */
	readonly #queues = new WeakMap<Page, Promise<unknown>>();

	constructor(context: TSessionContext) {
		this.#context = context;
	}

	/** The feature's pages, where the session opened one. */
	get pages(): TBrowserPages | undefined {
		return this.#pages;
	}

	hasPage(tab: number): boolean {
		return this.#pages !== undefined && this.#pages.hasPage(this.#context.world.tag.featureNum, tab);
	}

	/** The current tab's page, opened where the tab doesn't hold one. */
	async page(): Promise<Page> {
		const { world, captureVideo, relayed } = this.#context;
		const driving = relayed() ? stepInFlight()?.outermost : undefined;
		if (driving !== undefined) this.#drivingFor.add(driving);
		const { featureNum } = world.tag;
		const opening = !this.hasPage(this.tab);
		this.#pages ??= this.#context.openPages();
		const pages = this.#pages;
		const page = await pages.page(featureNum, this.tab);
		if (opening) {
			// A page that opens may come to the front, so the next action brings its own page there.
			this.#front = undefined;
			if (captureVideo && !this.#videoStartEmitted) this.#emitVideoStart();
		}
		if (!this.#boundPages.has(page)) {
			this.#boundPages.add(page);
			page.on("popup", async (popup: Page) => {
				await popup.waitForLoadState();
				this.newTab();
				this.#front = undefined;
				pages.registerPopup(featureNum, this.tab, popup);
			});
			page.on("close", () => {
				if (this.#front === page) this.#front = undefined;
			});
			// An adopted page's errors are its owner's browsing, not actuality's.
			if (!pages.isAdopted(page)) page.on("pageerror", (error: Error) => this.browserErrors.push(error.message));
		}
		return page;
	}

	/** Runs one action on the page, after any action another caller is running on it: every caller of a running instance
	 *  shares its page. An action nested in another, such as the steps `in {container}, {what}` runs, holds the page
	 *  already and runs at once. Within a container, the page is the container's page. */
	async withPage<TReturn>(action: TPageAction<TReturn>): Promise<TReturn> {
		const page = this.inContainer === undefined ? await this.page() : this.inContainer.page();
		const held = this.#holding.getStore();
		if (held?.has(page)) return await this.#act(page, action);
		const queued = this.#queues.get(page);
		const after = queued === undefined ? Promise.resolve() : queued;
		const turn = after.then(() => this.#holding.run(new Set([...(held === undefined ? [] : held), page]), () => this.#act(page, action)));
		this.#queues.set(
			page,
			turn.catch((): void => undefined),
		);
		return await turn;
	}

	/** Runs one action where a step finds elements, as `withPage` runs one on the page. */
	async withScope<TReturn>(action: (scope: TPageScope) => TReturn | Promise<TReturn>): Promise<TReturn> {
		return await this.withPage((page) => action(this.inContainer === undefined ? page : this.inContainer));
	}

	/** Makes a new tab current: the first after the current one that actuality doesn't hold open, so a tab opened from an
	 *  earlier one, as a page's popup, doesn't take the place of one opened after it. */
	newTab(): void {
		let tab = this.tab + 1;
		while (this.hasPage(tab)) tab++;
		this.tab = tab;
	}

	/** A new feature's session: its first tab, without errors, video or the last feature's request headers. */
	startFeature(): void {
		this.tab = 0;
		this.browserErrors = [];
		this.#videoStartEmitted = false;
		this.extraHTTPHeaders = {};
		this.apiUserAgent = undefined;
	}

	/** Marks where the current step's errors start. */
	beforeStep(): void {
		this.errorMark = this.browserErrors.length;
	}

	/** The errors the page threw during the current step. */
	stepErrors(): string[] {
		return this.browserErrors.slice(this.errorMark);
	}

	/** Lets go of the relayed browser once the outermost step of the last call that drove it ends: the debugger leaves its
	 *  tabs, and with it Chrome's debugging infobar, until a step drives it again. A turn's calls run within its step, so
	 *  they drive it on one connection. */
	async releaseAfter(step: ReturnType<typeof stepInFlight>): Promise<void> {
		if (!step || step.outermost !== step.seqPath || !this.#drivingFor.delete(step.seqPath) || this.#drivingFor.size > 0) return;
		this.#front = undefined;
		if (this.#pages) await this.#pages.disconnect();
	}

	/** Closes the feature's context and its browser, and ends the session's pages. */
	async close(): Promise<void> {
		const pages = this.#pages;
		if (pages === undefined) return;
		this.#pages = undefined;
		this.#front = undefined;
		await pages.closeContext(this.#context.world.tag.featureNum);
		await pages.close();
	}

	/** Runs one action on the page with its tab in front, since a browser doesn't draw a page in a background tab, and an
	 *  action such as a click waits for the page to draw. A page another tab took the front from comes back to it first. */
	async #act<TReturn>(page: Page, action: TPageAction<TReturn>): Promise<TReturn> {
		if (this.#front !== page) {
			await page.bringToFront();
			this.#front = page;
		}
		const twin = this.#context.twin();
		if (this.inContainer === undefined && twin !== undefined) await twin.patchPage(page);
		return await action(page);
	}

	#emitVideoStart(): void {
		const { world } = this.#context;
		const { featureNum } = world.tag;
		this.#videoStartEmitted = true;
		const videoStart = VideoStartArtifact.parse({
			id: `feat-${featureNum}.video-start`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "video-start",
			startTime: 0,
			level: "debug",
		});
		world.eventLogger.artifact(featureStepOf(featureNum, "video recording started"), videoStart);
	}
}
