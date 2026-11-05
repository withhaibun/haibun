// @vitest-environment jsdom
/** An individual that other records point at links to them, with how many there are: "or more" where the site's count
 *  stopped at its ceiling, since a stopped count is a floor. */
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { countedTo } from "@haibun/core/lib/domains/hypermedia.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test/setup.js";
import { endPage } from "../adapters/page-held.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { instanceLabel } from "../controllers/record-controller.js";

const CEILING = 3;

describe("shu-entity-column what links here", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({
			dispatch: makeEntityDispatch({ entity: () => ({ vertex: { "@id": heldRecordIri("Task", "t1"), title: "a task" }, edges: [], incomingCount: countedTo(CEILING, CEILING) }) }),
		});
	});
	afterEach(() => handle.teardown());

	it("links to the records pointing at an individual, stating a count that stopped at its ceiling as a floor", async () => {
		const el = new ShuEntityColumn();
		document.body.appendChild(el);
		await el.open("t1", "Task");
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector(".links-here-link")?.textContent).toBe(`What links here (${CEILING} or more)`);
	});

	it("titles the pane that holds it by its record's title once the record is read", async () => {
		const pane = document.createElement(SHU_TAG.COLUMN_PANE);
		pane.dataset.columnKey = "e:Task:t1";
		const titles: unknown[] = [];
		pane.addEventListener(SHU_EVENT.PANE_RELABEL, (e) => titles.push((e as CustomEvent).detail));
		const el = new ShuEntityColumn();
		pane.appendChild(el);
		document.body.appendChild(pane);
		await el.open("t1", "Task");
		await el.updateComplete;
		expect(titles.at(-1)).toEqual({ paneId: "e:Task:t1", label: instanceLabel({ "@id": heldRecordIri("Task", "t1"), title: "a task" }) });
	});
});
