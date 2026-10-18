// @vitest-environment jsdom
/**
 * The list of views a deployment declares. It draws a row per view and opens the one a reader presses; whoever
 * declares the views decides what they are.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { SHU_TAG } from "../../domains/elements.js";
import { ShuViewsPicker } from "./shu-views-picker.js";
import { followPaneRequests } from "../../test/pane-requests.js";

const IDS = SHU_TEST_IDS.VIEWS_PICKER;
const views = [
	{ id: "run", description: "actuality as it happens", component: SHU_TAG.MONITOR_COLUMN },
	{ id: "cache", description: "what this page holds", component: SHU_TAG.CLIENT_CACHE_COLUMN },
];

const pickerOf = async (offered = views): Promise<ShuViewsPicker> => {
	const picker = new ShuViewsPicker();
	picker.setViews(offered);
	document.body.append(picker);
	await picker.updateComplete;
	return picker;
};
const rowsOf = (picker: ShuViewsPicker): HTMLElement[] => [...(picker.shadowRoot?.querySelectorAll(`[data-testid^='${IDS.ROW}']`) ?? [])] as HTMLElement[];

describe("the views a deployment offers", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("draws a row per view, named by the view that row opens", async () => {
		const picker = await pickerOf();
		expect(rowsOf(picker).map((row) => row.dataset.testid)).toEqual([`${IDS.ROW}${SHU_TAG.MONITOR_COLUMN}`, `${IDS.ROW}${SHU_TAG.CLIENT_CACHE_COLUMN}`]);
	});

	it("asks for the view a pressed row names, so a press opens that view and doesn't open another", async () => {
		const asked = followPaneRequests();
		const picker = await pickerOf();
		itemAt(rowsOf(picker), 1).click();
		expect(asked.requested).toEqual([{ paneType: "component", tag: SHU_TAG.CLIENT_CACHE_COLUMN, label: "what this page holds" }]);
		asked.stop();
	});
});
