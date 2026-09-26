// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const reported: Array<{ message: string; attributes?: Record<string, unknown> }> = [];
vi.mock("./client-log.js", () => ({
	reportToRun: (_level: string, _source: string, message: string, attributes?: Record<string, unknown>) => reported.push({ message, attributes }),
}));

const { EMBEDDED_PAGE_TYPE, embeddedPageView, receiveFromEmbedder } = await import("./embedder.js");

const EMBEDDER = "chrome-extension://abcdefghijklmnop";
const PAGE = {
	"@id": "https://example.com/bakery",
	"@type": EMBEDDED_PAGE_TYPE,
	name: "The bakery",
	selection: { "@type": "oa:SpecificResource", source: "https://example.com/bakery", selector: { "@type": "oa:TextQuoteSelector", exact: "sourdough" } },
	next: { method: "WebPlaywright-readPage", params: {} },
} as const;

/** A frame whose embedding window is `parent`, which receives what is posted to it. */
const aFrame = (parent: Window) => Object.assign(new EventTarget(), { parent }) as unknown as Window;
const post = (frame: Window, data: unknown, origin: string, source: Window) => frame.dispatchEvent(new MessageEvent("message", { data, origin, source }));

describe("what the page embedding shu posts", () => {
	beforeEach(() => {
		reported.length = 0;
		embeddedPageView.set(null);
	});

	it("holds the page the embedding window posts from the origin the deployment names, and clears it when the reader leaves it", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(EMBEDDER, frame);
		post(frame, { kind: "page-view", view: PAGE }, EMBEDDER, window);
		expect(embeddedPageView.get()).toEqual(PAGE);
		post(frame, { kind: "page-view", view: null }, EMBEDDER, window);
		expect(embeddedPageView.get()).toBeNull();
		stop();
	});

	it("refuses a message from the embedding window at another origin, and reports it to the run", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(EMBEDDER, frame);
		post(frame, { kind: "page-view", view: PAGE }, "https://elsewhere.example", window);
		expect(embeddedPageView.get()).toBeNull();
		expect(reported).toEqual([{ message: "refused a message from an embedding page at another origin", attributes: { origin: "https://elsewhere.example" } }]);
		stop();
	});

	it("refuses a message its schema doesn't read, and doesn't read a message from a window that doesn't embed shu", () => {
		const frame = aFrame(window);
		const stop = receiveFromEmbedder(EMBEDDER, frame);
		post(frame, { kind: "page-view", view: { ...PAGE, script: "alert(1)" } }, EMBEDDER, window);
		expect(embeddedPageView.get()).toBeNull();
		expect(reported.map((r) => r.message)).toEqual(["refused a message from the embedding page"]);
		const other = aFrame({} as Window);
		const stopOther = receiveFromEmbedder(EMBEDDER, other);
		post(other, { kind: "page-view", view: PAGE }, EMBEDDER, window);
		expect(embeddedPageView.get(), "the posting window isn't the frame's parent").toBeNull();
		stop();
		stopOther();
	});
});
