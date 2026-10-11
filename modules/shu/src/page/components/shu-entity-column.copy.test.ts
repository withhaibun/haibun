// @vitest-environment jsdom
/** The body toolbar copies the body the column shows, and drawing the column again leaves the body's frame in place. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test-setup.js";
import { endPage } from "../adapters/page-held.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { BODY_LABEL } from "@haibun/core/lib/resources.js";

const BODY = "the body a reader copies";

describe("shu-entity-column copying its body", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
		const task = { "@id": "t1", title: "a task", hasBody: [{ id: "t1-body", mediaType: "text/plain", content: BODY }] };
		const body = { "@id": "t1-body", mediaType: "text/plain", content: BODY };
		const read = (vertex: Record<string, unknown>) => ({ vertex, edges: [], incomingCount: { total: 0, saturated: false } });
		handle = setupShuTest({ dispatch: makeEntityDispatch({ entity: (params) => read(params.label === BODY_LABEL ? body : task) }) });
	});
	afterEach(() => handle.teardown());

	it("copies the shown body, and keeps the same frame when the column draws again", async () => {
		const el = new ShuEntityColumn();
		document.body.appendChild(el);
		await el.open("t1", "Task");
		await el.updateComplete;
		const frame = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}"]`);
		expect(frame, "the body frame").toBeTruthy();
		el.requestUpdate();
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}"]`), "the same frame after drawing again").toBe(frame);
		const copy = el.shadowRoot?.querySelector<HTMLElement>(".copy-btn");
		if (!copy) throw new Error("the body toolbar doesn't show its copy control");
		copy.click();
		await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BODY));
	});
});
