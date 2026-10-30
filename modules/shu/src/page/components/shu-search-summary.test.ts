// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { ViewQuerySchema, type TViewQuery } from "../domains/view-query.js";
import { SHU_EVENT } from "../../domains/elements.js";
import { describeSearch, ShuSearchSummary } from "./shu-search-summary.js";
import { ShuActivityHistory } from "./shu-activity-history.js";
import { newPage } from "../../test/setup.js";

const query = (over: Partial<TViewQuery>): TViewQuery => ViewQuerySchema.parse(over);

describe("describeSearch", () => {
	it("names the type, quoted text, the class expression, and non-default access", () => {
		const q = query({ label: "Email", q: "INBOX", x: 'folder value "INBOX"', access: "public" });
		expect(describeSearch(q)).toBe('Email · "INBOX" · folder value "INBOX" · public');
	});

	it("omits absent parts: a text-only search reads as just its text; default access is not stated", () => {
		expect(describeSearch(query({ q: "hydration" }))).toBe('"hydration"');
	});
});

describe("shu-search-summary restore", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("clicking the entry dispatches SEARCH_RESTORE carrying the exact snapshot it was recorded with", async () => {
		const el = document.createElement("shu-search-summary") as ShuSearchSummary;
		const snapshot = query({ label: "Email", q: "INBOX" });
		el.query = snapshot;
		document.body.appendChild(el);
		await el.updateComplete;
		let restored: TViewQuery | null = null;
		document.body.addEventListener(SHU_EVENT.SEARCH_RESTORE, ((e: CustomEvent) => {
			restored = e.detail.query;
		}) as EventListener);
		el.click();
		expect(restored).toEqual(snapshot);
	});

	it("restoring an entry without a snapshot throws: a recorder must set .query before appending", async () => {
		const el = document.createElement("shu-search-summary") as ShuSearchSummary;
		document.body.appendChild(el);
		await el.updateComplete;
		expect(() => el.restore()).toThrow(/doesn't have a query snapshot/);
	});

	it("the x removes the entry without restoring it: the same affordance a step result carries", async () => {
		const el = document.createElement("shu-search-summary") as ShuSearchSummary;
		el.query = query({ label: "Email", q: "INBOX" });
		document.body.appendChild(el);
		await el.updateComplete;
		let restored = false;
		document.body.addEventListener(SHU_EVENT.SEARCH_RESTORE, () => {
			restored = true;
		});
		(el.querySelector(".dismiss-btn") as HTMLButtonElement).click();
		expect(el.isConnected).toBe(false);
		expect(restored).toBe(false);
	});
});

describe("shu-activity-history", () => {
	// The history reads its address from the page, which reads its hydration at its start.
	beforeEach(newPage);

	it("appended entries are real light-DOM children, in arrival order, surviving a re-render", async () => {
		const history = document.createElement("shu-activity-history");
		expect(history).toBeInstanceOf(ShuActivityHistory);
		if (!(history instanceof ShuActivityHistory)) throw new Error("unreachable");
		document.body.appendChild(history);
		await history.updateComplete;
		const a = document.createElement("shu-search-summary");
		const b = document.createElement("div");
		history.append(a);
		history.append(b);
		history.requestUpdate();
		await history.updateComplete;
		const children = Array.from(history.children).filter((c) => c === a || c === b);
		expect(children).toEqual([a, b]);
	});
});
