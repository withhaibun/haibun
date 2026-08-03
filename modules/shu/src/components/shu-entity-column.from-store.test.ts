// @vitest-environment jsdom
/** A reader should be able to tell a stored copy from a fresh one: an individual served from the session copy or, when
 *  the server cannot be reached, the persisted browser store says so; a freshly fetched one carries no such claim. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { resetEntityStore } from "../entity-store.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../test-setup.js";
import { SHU_TEST_IDS } from "../test-ids.js";

const badge = (el: ShuEntityColumn): string | undefined => el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.FROM_STORE}"]`)?.textContent ?? undefined;

describe("shu-entity-column stored-copy indication", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		resetEntityStore();
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({ dispatch: makeEntityDispatch({ entity: () => ({ vertex: { "@id": "t1", title: "a task" }, edges: [], incomingCount: 0 }) }) });
	});
	afterEach(() => handle.teardown());

	const open = async (): Promise<ShuEntityColumn> => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		await el.open("t1", "Task");
		await el.updateComplete;
		return el;
	};

	it("makes no claim about a freshly fetched individual", async () => {
		const el = await open();
		expect(badge(el)).toBeUndefined();
	});

	it("says so when the individual is served from the copy already held, rather than fetched again", async () => {
		await open(); // resolves and holds it
		const second = await open(); // a second view of the same individual is served from that copy
		expect(badge(second)).toContain("copy held this session");
	});
});
