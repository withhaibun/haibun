// @vitest-environment jsdom
/**
 * A note quotes its Body as the Body read when the note was written. Once the Body changes, the note is stale: the view shows it
 * where the text reads its quote still, marked modified with a link to its anchor, and lists it where the text doesn't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TAnnotationView } from "@haibun/core/lib/domains/resources.js";
import { ANCHOR_STATE } from "@haibun/core/lib/domains/quote-anchor.js";
import { ShuAnnotatedBody } from "./shu-annotated-body.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";

/** The Body the view shows, as it reads now. */
const SHOWN = { id: "b-1", digest: "now" };
const note = (commentId: string, sourceDigest: string): TAnnotationView => ({
	commentId,
	specificResourceId: `sr-${commentId}`,
	exact: "hiking",
	body: `note ${commentId}`,
	source: SHOWN.id,
	sourceDigest,
});

describe("shu-annotated-body's notes on an earlier text", () => {
	let el: ShuAnnotatedBody | undefined;
	beforeEach(() => {
		provideLayout();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
	});
	// The text annotator's destroy() leaves its debounced redraws pending, some behind a promise, so they run here, while the
	// document they draw in exists.
	afterEach(async () => {
		el?.remove();
		el = undefined;
		await vi.runAllTimersAsync();
		vi.useRealTimers();
	});

	it("shows a note on an earlier text where the text reads its quote still, marked modified with a link to its anchor", async () => {
		el = new ShuAnnotatedBody();
		Object.assign(el, { content: "Anyone up for hiking this weekend?", mediaType: "text/plain", sourceId: "e1", sourceLabel: "Email", quoted: SHOWN });
		el.annotations = [note("c-1", SHOWN.digest), note("c-2", "before")];
		document.body.appendChild(el);
		await el.updateComplete;
		vi.advanceTimersByTime(80);
		await el.updateComplete;
		const cards = [...el.querySelectorAll(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_CARD}"]`)];
		expect(cards.map((card) => card.getAttribute("data-comment-id")).sort()).toEqual(["c-1", "c-2"]);
		const modified = (id: string) => el?.querySelector(`[data-comment-id="${id}"] [data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_CARD_MODIFIED}"]`);
		expect(modified("c-1"), "a current note isn't marked").toBeNull();
		expect(modified("c-2")?.textContent).toContain("The text was modified after this note quoted it.");
		const details = modified("c-2")?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_CARD_DETAILS}"]`);
		expect(decodeURIComponent(details?.getAttribute("href") ?? ""), "the link opens the note's anchor").toContain("sr-c-2");
		expect(el.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_STALE_NOTES}"]`), "a placed note isn't listed").toBeNull();
	});

	it("lists a note on an earlier text whose quote the text doesn't read now, with its mark and its quote", async () => {
		el = new ShuAnnotatedBody();
		Object.assign(el, { content: "Anyone up for a walk this weekend?", mediaType: "text/plain", sourceId: "e1", sourceLabel: "Email", quoted: SHOWN });
		el.annotations = [note("c-2", "before")];
		document.body.appendChild(el);
		await el.updateComplete;
		vi.advanceTimersByTime(80);
		await el.updateComplete;
		const stale = [...el.querySelectorAll(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_STALE_NOTE}"]`)];
		expect(stale.map((item) => item.getAttribute("data-comment-id"))).toEqual(["c-2"]);
		expect(stale[0]?.querySelector(".anchor-stale")?.textContent).toBe(ANCHOR_STATE.stale);
		expect(stale[0]?.textContent).toContain("“hiking”");
	});

	it("doesn't list a note when each note quotes the Body as it reads", async () => {
		el = new ShuAnnotatedBody();
		Object.assign(el, { content: "Anyone up for hiking this weekend?", mediaType: "text/plain", sourceId: "e1", sourceLabel: "Email", quoted: SHOWN });
		el.annotations = [note("c-1", SHOWN.digest)];
		document.body.appendChild(el);
		await el.updateComplete;
		expect(el.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATION_STALE_NOTES}"]`)).toBeNull();
	});
});
