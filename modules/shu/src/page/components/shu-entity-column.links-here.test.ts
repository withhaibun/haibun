// @vitest-environment jsdom
/** An individual that other records point at links to them, with how many there are: "or more" where the site's count
 *  stopped at its ceiling, since a stopped count is a floor. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { countedTo } from "@haibun/core/lib/hypermedia.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../../test-setup.js";
import { endPage } from "../../page-pinned.js";

const CEILING = 3;

describe("shu-entity-column what links here", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
		handle = setupShuTest({
			dispatch: makeEntityDispatch({ entity: () => ({ vertex: { "@id": "t1", title: "a task" }, edges: [], incomingCount: countedTo(CEILING, CEILING) }) }),
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
});
