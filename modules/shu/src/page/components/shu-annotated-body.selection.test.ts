// @vitest-environment jsdom
/**
 * A passage a reader opens from a field shows selected and holds the keyboard's focus, so the reader reads and moves from it, until
 * another passage is revealed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShuAnnotatedBody } from "./shu-annotated-body.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";

const CONTENT = "Subject: Registration confirmation\nFrom: Support Team <support@example.com>\n\nWelcome.";
const SUBJECT = { exact: "Registration confirmation", prefix: "Subject: ", suffix: "\nFrom: Support" };
const SENDER = { exact: "Support Team <support@example.com>", prefix: "From: ", suffix: "\n\nWelcome." };

const selected = (el: ShuAnnotatedBody): HTMLElement | null => el.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATED_BODY_SELECTED}"]`);

describe("shu-annotated-body selected passage", () => {
	let el: ShuAnnotatedBody | undefined;
	beforeEach(() => {
		provideLayout();
		el = new ShuAnnotatedBody();
		el.content = CONTENT;
		el.mediaType = "text/plain";
		el.sourceId = "e1";
		el.sourceLabel = "Email";
		document.body.appendChild(el);
	});
	afterEach(() => {
		el?.remove();
		el = undefined;
	});

	it("selects the passage a quote names and gives it the keyboard's focus", async () => {
		const body = el as ShuAnnotatedBody;
		body.revealTarget = SUBJECT;
		const mark = await vi.waitFor(() => {
			const found = selected(body);
			if (found === null) throw new Error("the passage isn't selected yet");
			return found;
		});
		expect(mark.textContent).toBe(SUBJECT.exact);
		expect(document.activeElement, "the passage holds the keyboard's focus").toBe(mark);
	});

	it("lets go of the passage it selected where another passage is revealed", async () => {
		const body = el as ShuAnnotatedBody;
		body.revealTarget = SUBJECT;
		await vi.waitFor(() => {
			if (selected(body) === null) throw new Error("the subject isn't selected yet");
		});
		body.revealTarget = SENDER;
		await vi.waitFor(() => {
			if (selected(body)?.textContent !== SENDER.exact) throw new Error("the sender isn't selected yet");
		});
		expect(body.querySelectorAll(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATED_BODY_SELECTED}"]`)).toHaveLength(1);
	});
});
