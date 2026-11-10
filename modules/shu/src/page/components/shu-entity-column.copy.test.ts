// @vitest-environment jsdom
/** The body container carries data-copy with the body the column shows, and drawing the column again leaves the body's frame in place. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { bodyRendered, setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test/setup.js";
import { endPage } from "../adapters/page-held.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { BODY_LABEL } from "@haibun/core/lib/domains/resources.js";

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
		const el = document.body.appendChild(new ShuEntityColumn());
		await el.open("t1", "Task");
		await bodyRendered(el);
		const frame = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}"]`);
		expect(frame, "the body frame").toBeTruthy();
		el.requestUpdate();
		await bodyRendered(el);
		expect(el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}"]`), "the same frame after drawing again").toBe(frame);
		const copyContainer = el.shadowRoot?.querySelector<HTMLElement>(".body-container");
		if (!copyContainer) throw new Error("the body container doesn't show");
		expect(copyContainer.getAttribute("data-copy")).toBe(BODY);
	});
});
