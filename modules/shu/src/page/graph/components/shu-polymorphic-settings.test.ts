// @vitest-environment jsdom
/**
 * Where the graph view's options are: each settings group renders its own controls and not another group's, the view
 * control offers every view the graph draws, a view that settles an option doesn't offer its control, and the actions stay on
 * the head with a settings icon for each group.
 */
import { describe, expect, it } from "vitest";
import { html, render } from "lit";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { VIEW, VIEW_CHOICES } from "../domains/views.js";
import { viewActions } from "./view-head.js";
import type { TPolymorphicOptions } from "./shu-polymorphic-settings.js";
import type { TViewForces } from "./render-type.js";
import "./shu-polymorphic-settings.js";

const IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;
const OPTIONS: TPolymorphicOptions = {
	viewType: VIEW.force,
	flatten: false,
	grouped: true,
	groupBy: "type",
	zBasis: "valid",
	labelAsZ: false,
	follow: false,
	prune: false,
	readAsDocument: false,
};
/** Settings icons, toggles and actions on the head, and the controls of each group, by test id. */
const LAYOUT = [IDS.VIEW_TYPE, IDS.GROUPED, IDS.GROUP_BY, IDS.FLATTEN, IDS.Z_BASIS, IDS.LABEL_AS_Z];
const SCENES = [IDS.SCENE_PICKER, IDS.SCENE_NAME, IDS.SCENE_SAVE];

type TSettings = HTMLElement & { group: "layout" | "scenes"; options: TPolymorphicOptions; choices: readonly string[]; forces: TViewForces; updateComplete: Promise<boolean> };

async function settings(group: "layout" | "scenes", forces: TViewForces = {}): Promise<TSettings> {
	document.body.innerHTML = "";
	const el = document.createElement(SHU_TAG.POLYMORPHIC_SETTINGS) as TSettings;
	Object.assign(el, { group, options: OPTIONS, choices: VIEW_CHOICES, forces, onChange: () => undefined, onApplyScene: () => undefined, onSaveScene: () => undefined });
	document.body.append(el);
	await el.updateComplete;
	return el;
}
const shown = (root: ParentNode, ids: readonly string[]): string[] => ids.filter((id) => root.querySelector(`[data-testid="${id}"]`) !== null);

describe("the graph view's settings groups", () => {
	it("holds every layout option under the layout group, without the scenes' controls", async () => {
		const el = await settings("layout");
		expect(shown(el, LAYOUT)).toEqual(LAYOUT);
		expect(shown(el, SCENES)).toEqual([]);
	});

	it("holds the scenes' controls under the scenes group, without the layout's", async () => {
		const el = await settings("scenes");
		expect(shown(el, SCENES)).toEqual(SCENES);
		expect(shown(el, LAYOUT)).toEqual([]);
	});

	it("offers every view the graph draws in the view control", async () => {
		const el = await settings("layout");
		expect([...el.querySelectorAll<HTMLOptionElement>(`[data-testid="${IDS.VIEW_TYPE}"] option`)].map((o) => o.value)).toEqual([...VIEW_CHOICES]);
	});

	it("doesn't offer the grouping a lane view settles, whose lifelines are its grouping", async () => {
		const el = await settings("layout", { grouped: false, flatten: false, labelAsZ: false });
		expect(shown(el, [IDS.GROUPED, IDS.GROUP_BY, IDS.FLATTEN, IDS.LABEL_AS_Z])).toEqual([]);
		expect(shown(el, [IDS.VIEW_TYPE, IDS.Z_BASIS])).toEqual([IDS.VIEW_TYPE, IDS.Z_BASIS]);
	});
});

describe("the graph view's head", () => {
	it("keeps fit and copy beside a settings icon for each group, whichever group is open", () => {
		for (const openGroup of [null, "layout", "filters", "scenes"] as const) {
			const head = document.createElement("div");
			render(
				html`${viewActions({ fitId: IDS.FIT, copyId: IDS.COPY_GRAPH, onFit: () => undefined, getCopyText: () => "", settings: { openGroup, idFor: (group) => IDS.SETTINGS[group], onGroup: () => undefined } })}`,
				head,
			);
			expect(shown(head, [IDS.FIT, IDS.COPY_GRAPH, ...Object.values(IDS.SETTINGS)]), `with ${openGroup} open`).toEqual([IDS.FIT, IDS.COPY_GRAPH, ...Object.values(IDS.SETTINGS)]);
			const pressed = [...head.querySelectorAll('[aria-pressed="true"]')].map((b) => b.getAttribute("data-testid"));
			expect(pressed, "one group open at a time").toEqual(openGroup === null ? [] : [IDS.SETTINGS[openGroup]]);
		}
	});
});
