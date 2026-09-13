// @vitest-environment jsdom
/**
 * How the actions bar stands, held apart from the bar: its open height and its strip, the scope of the active record it
 * opens and closes, a drag of its top edge, the pin against a click elsewhere, and the footprint of its closed strip.
 * jsdom does no layout, so the heights the bar reads are stated by each case.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { ActionsBarHeight, type THeightState } from "./actions-bar-height.js";
import { PROPORTION } from "./actions-bar-model.js";
import { ACTIONS_BAR_FOOTPRINT, SHU_ATTR } from "../consts.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState } from "../current-subject.js";
import { provideLayout } from "../test/jsdom-layout.js";

/** An element as a controller sees its host: it holds controllers and can be asked to render. */
class HeightHost extends HTMLElement implements ReactiveControllerHost {
	readonly controllers: ReactiveController[] = [];
	readonly updateComplete = Promise.resolve(true);
	addController(controller: ReactiveController): void {
		this.controllers.push(controller);
	}
	removeController(): void {
		/* a case keeps its controller for the bar's lifetime */
	}
	requestUpdate(): void {
		/* a case renders by calling the controller's update hooks */
	}
}
customElements.define("height-test-host", HeightHost);

/** A stated layout number, which jsdom leaves at zero. */
const stateNumber = (el: HTMLElement, name: "offsetHeight" | "clientHeight", read: () => number) => Object.defineProperty(el, name, { configurable: true, get: read });

type TBar = { host: HeightHost; height: ActionsBarHeight; state: THeightState; container: HTMLElement; summary: HTMLElement; sizes: { bar: number; strip: number } };

function aBar(initial: Partial<THeightState> = {}): TBar {
	provideLayout();
	document.body.innerHTML = "";
	const container = document.createElement("div");
	const host = new HeightHost();
	const summary = document.createElement("div");
	const frame = document.createElement("div");
	container.append(host);
	document.body.append(container);
	const sizes = { bar: 200, strip: 40 };
	stateNumber(container, "clientHeight", () => 1000);
	stateNumber(host, "offsetHeight", () => sizes.bar);
	stateNumber(summary, "offsetHeight", () => sizes.strip);
	Object.defineProperty(host, "offsetParent", { configurable: true, get: () => container });
	const bar: TBar = { host, container, summary, sizes, state: { askExpanded: false, pinned: false, heightProportion: 0.5, ...initial }, height: undefined as never };
	bar.height = new ActionsBarHeight(host, {
		state: () => bar.state,
		setState: (patch) => Object.assign(bar.state, patch),
		strip: () => ({ summary, frame }),
		focusInput: () => undefined,
	});
	bar.height.hostConnected();
	return bar;
}

/** The bar's height as a percentage of its container, or nothing where it stands at its strip. */
const percentTall = (el: HTMLElement) => (el.style.height.endsWith("%") ? Number.parseFloat(el.style.height) : undefined);
const pointer = (type: string, clientY: number) => new PointerEvent(type, { pointerId: 1, clientY, bubbles: true });

describe("how the actions bar stands", () => {
	beforeEach(() => {
		currentSubjectState.set(INITIAL_SUBJECT);
	});

	it("stands at its remembered height and covers the views while open, and at its strip while closed", () => {
		const bar = aBar({ askExpanded: true });
		bar.height.hostUpdate();
		expect(percentTall(bar.host)).toBe(50);
		expect(bar.host.hasAttribute(SHU_ATTR.DATA_COVERS_VIEWS)).toBe(true);
		bar.state.askExpanded = false;
		bar.height.hostUpdate();
		expect(percentTall(bar.host)).toBeUndefined();
		expect(bar.host.hasAttribute(SHU_ATTR.DATA_COVERS_VIEWS)).toBe(false);
	});

	it("opens its scope of the active record with the bar, closes it with the bar, and closes it when the bar goes", () => {
		const bar = aBar({ askExpanded: true });
		bar.height.hostUpdate();
		expect(currentSubjectState.get().open).toContain(SCOPE.actionsBar);
		bar.state.askExpanded = false;
		bar.height.hostUpdate();
		expect(currentSubjectState.get().open).not.toContain(SCOPE.actionsBar);
		bar.state.askExpanded = true;
		bar.height.hostUpdate();
		bar.height.hostDisconnected();
		expect(currentSubjectState.get().open, "a bar removed from the page leaves its scope closed").not.toContain(SCOPE.actionsBar);
	});

	it("remembers a drag of its top edge as a fraction of its container, within the bounds", () => {
		const bar = aBar({ askExpanded: true });
		bar.height.onResizeDown(pointer("pointerdown", 800));
		bar.sizes.bar = 950;
		document.dispatchEvent(pointer("pointerup", 50));
		expect(bar.state.heightProportion).toBe(PROPORTION.max);
		expect(percentTall(bar.host)).toBe(PROPORTION.max * 100);
	});

	it("closes on a click elsewhere, and stays open when pinned, when the click is inside it, or when the click picks one of its combobox's options", () => {
		const bar = aBar({ askExpanded: true, pinned: true });
		document.body.click();
		expect(bar.state.askExpanded, "pinned").toBe(true);
		bar.state.pinned = false;
		const inside = document.createElement("button");
		bar.host.append(inside);
		inside.click();
		expect(bar.state.askExpanded, "a click inside").toBe(true);
		const options = document.createElement("ul");
		options.setAttribute("role", "listbox");
		options.dataset.comboOwner = bar.host.localName;
		const option = document.createElement("li");
		options.append(option);
		document.body.append(options);
		option.click();
		expect(bar.state.askExpanded, "an option of its combobox").toBe(true);
		document.body.click();
		expect(bar.state.askExpanded, "a click elsewhere").toBe(false);
	});

	it("pins a closed bar open, and leaves it open when unpinned", () => {
		const bar = aBar();
		bar.height.onPinToggle(new Event("click"));
		expect(bar.state).toMatchObject({ pinned: true, askExpanded: true });
		bar.height.onPinToggle(new Event("click"));
		expect(bar.state).toMatchObject({ pinned: false, askExpanded: true });
	});

	it("opens a bar that was pinned once its remembered state is restored, and not one that was not", () => {
		const unpinned = aBar();
		unpinned.height.openIfPinned();
		expect(unpinned.state.askExpanded).toBe(false);
		const pinned = aBar({ pinned: true });
		pinned.height.openIfPinned();
		expect(pinned.state.askExpanded).toBe(true);
	});

	it("reserves its closed strip's height on its positioning host as the strip changes, and releases it when the bar goes", () => {
		const bar = aBar();
		bar.height.hostUpdated();
		expect(bar.container.style.getPropertyValue(ACTIONS_BAR_FOOTPRINT)).toBe("40px");
		bar.sizes.strip = 64;
		bar.height.hostUpdated();
		expect(bar.container.style.getPropertyValue(ACTIONS_BAR_FOOTPRINT)).toBe("64px");
		bar.height.hostDisconnected();
		expect(bar.container.style.getPropertyValue(ACTIONS_BAR_FOOTPRINT)).toBe("");
	});
});
