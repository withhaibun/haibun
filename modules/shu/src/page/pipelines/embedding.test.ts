// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EMBED_MESSAGE, EMBEDDED_PAGE_TYPE } from "../../domains/embedding.js";
import { askEmbedderToDelegate, receiveFromEmbedder, type TEmbedding } from "./embedding.js";
import { embedderChannel } from "../adapters/embedder-channel.js";
import { embeddedPageView, givenDelegation, pageAuthorityPort, pageClock } from "../root.js";
import { pageMay } from "../authority/controllers/page-authority-controller.js";
import { openReportingPage, reportingTo, setupShuTest, type TReportedToRun, type TShuTestHandle } from "../../test-setup.js";

const reported: TReportedToRun[] = [];
let t: TShuTestHandle;
beforeEach(async () => {
	reported.length = 0;
	t = setupShuTest({ dispatch: reportingTo(reported) });
	await openReportingPage();
});
afterEach(() => t.teardown());

const EMBEDDER = "chrome-extension://abcdefghijklmnop";
const PAGE = {
	"@id": "https://example.com/bakery",
	"@type": EMBEDDED_PAGE_TYPE,
	name: "The bakery",
	selection: { "@type": "oa:SpecificResource", source: "https://example.com/bakery", selector: { "@type": "oa:TextQuoteSelector", exact: "sourdough" } },
	next: { method: "WebPlaywright-readPage", params: {} },
} as const;

/** A delegation the embedding page signs to `controller`. It allows a private read. */
const delegationTo = (controller: string, id = "urn:uuid:to-the-frame") => ({
	id,
	controller,
	parentCapability: "urn:uuid:the-embedders",
	invocationTarget: "http://localhost:8123",
	allowedAction: ["Read:private"],
	expires: "2099-01-01T00:00:00.000Z",
	proof: { type: "DataIntegrityProof" },
});

/** A frame whose embedding window is `parent`. The frame receives the messages posted to it. */
const aFrame = (parent: Window) => Object.assign(new EventTarget(), { parent }) as unknown as Window;
const post = (frame: Window, data: unknown, origin: string, source: Window) => frame.dispatchEvent(new MessageEvent("message", { data, origin, source }));
/** What the pipeline reads in `frame`: its channel to the embedding page, the page's cells and its clock. */
const embedding = (frame: Window): TEmbedding => ({ channel: embedderChannel(frame, EMBEDDER), pageView: embeddedPageView, given: givenDelegation, authority: pageAuthorityPort(), clock: pageClock() });

describe("what the page embedding shu posts", () => {
	beforeEach(() => embeddedPageView.set(null));

	it("holds the page the embedding window posts from the origin the deployment names, and clears it when the reader leaves it", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(embedding(frame));
		post(frame, { kind: "page-view", view: PAGE }, EMBEDDER, window);
		expect(embeddedPageView.get()).toEqual(PAGE);
		post(frame, { kind: "page-view", view: null }, EMBEDDER, window);
		expect(embeddedPageView.get()).toBeNull();
		stop();
	});

	it("refuses a message from the embedding window at another origin, and reports it to actuality", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(embedding(frame));
		post(frame, { kind: "page-view", view: PAGE }, "https://elsewhere.example", window);
		expect(embeddedPageView.get()).toBeNull();
		expect(reported.map(({ message, attributes }) => ({ message, attributes }))).toEqual([
			{ message: "refused a message from an embedding page at another origin", attributes: { origin: "https://elsewhere.example" } },
		]);
		stop();
	});

	it("refuses a message its schema doesn't read, and doesn't read a message from a window that doesn't embed shu", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(embedding(frame));
		post(frame, { kind: "page-view", view: { ...PAGE, script: "alert(1)" } }, EMBEDDER, window);
		expect(embeddedPageView.get()).toBeNull();
		expect(reported.map((r) => r.message)).toEqual(["refused a message from the embedding page"]);
		const other = aFrame({} as Window);
		const stopOther = receiveFromEmbedder(embedding(other));
		post(other, { kind: "page-view", view: PAGE }, EMBEDDER, window);
		expect(embeddedPageView.get(), "the posting window isn't the frame's parent").toBeNull();
		stop();
		stopOther();
	});
});

describe("the delegation the page embedding shu gives its key", () => {
	beforeEach(() => givenDelegation.set(null));

	it("is requested by posting the key to the embedding page, and each delegation that page posts replaces the one shu held", async () => {
		const { controller } = await openReportingPage();
		const posted: Array<{ message: unknown; origin: string }> = [];
		const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) } as unknown as Window;
		const frame = aFrame(parent);
		const stop = receiveFromEmbedder(embedding(frame));
		const asked = askEmbedderToDelegate(embedding(frame), controller, 1_000);
		expect(posted, "the key, to the embedding page's origin alone").toEqual([{ message: { kind: EMBED_MESSAGE.pageKey, controller }, origin: EMBEDDER }]);
		post(frame, { kind: EMBED_MESSAGE.delegation, delegation: delegationTo(controller) }, EMBEDDER, parent);
		await asked;
		expect(pageMay("Read:private")).toBe(true);
		const renewed = delegationTo(controller, "urn:uuid:renewed");
		post(frame, { kind: EMBED_MESSAGE.delegation, delegation: renewed }, EMBEDDER, parent);
		expect(givenDelegation.get()).toEqual(renewed);
		stop();
	});

	it("refuses a delegation to another key and reports it, and continues without a delegation when one isn't given in time", async () => {
		const { controller } = await openReportingPage();
		const parent = { postMessage: () => undefined } as unknown as Window;
		const frame = aFrame(parent);
		const stop = receiveFromEmbedder(embedding(frame));
		post(frame, { kind: EMBED_MESSAGE.delegation, delegation: delegationTo("did:key:zDnOther") }, EMBEDDER, parent);
		expect(reported.map((r) => r.message)).toEqual(["refused a delegation from the embedding page"]);
		await askEmbedderToDelegate(embedding(frame), controller, 10);
		expect(reported.map((r) => r.message).at(-1)).toBe("the embedding page didn't give a delegation to shu's page key");
		expect(pageMay("Read:private")).toBe(false);
		stop();
	});
});
