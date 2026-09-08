// @vitest-environment jsdom
/**
 * The list of views a deployment declares. It draws a row per view and opens the one a reader presses; what those views
 * are belongs to whoever gives them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SHU_TAG } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { ShuViewsPicker } from "./shu-views-picker.js";

if (!customElements.get(SHU_TAG.VIEWS_PICKER)) customElements.define(SHU_TAG.VIEWS_PICKER, ShuViewsPicker);

const IDS = SHU_TEST_IDS.VIEWS_PICKER;
const views = [
	{ id: "run", description: "the run as it happens", component: SHU_TAG.MONITOR_COLUMN },
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

	it("asks for the view a pressed row names, so a press opens that view and no other", async () => {
		const asked = vi.spyOn(PaneState, "request").mockImplementation(() => undefined);
		const picker = await pickerOf();
		rowsOf(picker)[1].click();
		expect(asked).toHaveBeenCalledWith({ paneType: "component", tag: SHU_TAG.CLIENT_CACHE_COLUMN, label: "what this page holds" });
	});
});
