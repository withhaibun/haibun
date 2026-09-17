// @vitest-environment jsdom
/**
 * How a docked pane stands, held apart from the pane: its open height and its strip, a drag of its top edge, closing on a
 * click elsewhere unless pinned, and the footprint of its closed strip. jsdom does no layout, so the heights the dock
 * reads are stated by each case.
 */
import { describe, expect, it } from "vitest";
import { PaneDock } from "./pane-dock.js";
import { PROPORTION } from "./dock-model.js";
import { DOCK_FOOTPRINT, SHU_ATTR } from "../consts.js";
import { dockedPane } from "../signals.js";
import { provideLayout } from "../test/jsdom-layout.js";
import { aControllerHost, type ControllerHostFake } from "./controller-host.test-fake.js";

/** A stated layout number, which jsdom leaves at zero. */
const stateNumber = (el: HTMLElement, name: "offsetHeight" | "clientHeight", read: () => number) => Object.defineProperty(el, name, { configurable: true, get: read });

type TState = { docked: boolean; closed: boolean; maximized: boolean; pinned: boolean; height: number | undefined };
type TDocked = { host: ControllerHostFake; dock: PaneDock; state: TState; container: HTMLElement; sizes: { pane: number; header: number } };

function aDockedPane(initial: Partial<TState> = {}): TDocked {
	provideLayout();
	const host = aControllerHost();
	const container = document.createElement("div");
	const header = Object.assign(document.createElement("div"), { className: "pane-header" });
	host.append(header);
	container.append(host);
	document.body.append(container);
	const sizes = { pane: 200, header: 40 };
	stateNumber(container, "clientHeight", () => 1000);
	stateNumber(host, "offsetHeight", () => sizes.pane);
	stateNumber(header, "offsetHeight", () => sizes.header);
	Object.defineProperty(host, "offsetParent", { configurable: true, get: () => container });
	const docked: TDocked = { host, container, sizes, state: { docked: true, closed: true, maximized: false, pinned: false, height: 0.5, ...initial }, dock: undefined as never };
	dockedPane.set(null);
	docked.dock = new PaneDock(host, {
		key: () => "Docked",
		docked: () => docked.state.docked,
		closed: () => docked.state.closed,
		setClosed: (closed) => Object.assign(docked.state, { closed }),
		maximized: () => docked.state.maximized,
		pinned: () => docked.state.pinned,
		height: () => docked.state.height,
		setHeight: (height) => Object.assign(docked.state, { height }),
	});
	host.connect();
	return docked;
}

/** Tell the pane's controllers it rendered, as lit does after each update. */
const rendered = (pane: TDocked) => {
	for (const controller of pane.host.controllers) controller.hostUpdated?.();
};

/** The pane's height as a percentage of its container, or nothing where it stands at its strip. */
const percentTall = (el: HTMLElement) => (el.style.height.endsWith("%") ? Number.parseFloat(el.style.height) : undefined);
const pointer = (type: string, clientY: number) => new PointerEvent(type, { pointerId: 1, clientY, bubbles: true });

describe("how a docked pane stands", () => {
	it("stands at its remembered height, or all of the app maximized, and covers the columns while open, and at its strip while closed", () => {
		const pane = aDockedPane({ closed: false });
		pane.dock.hostUpdate();
		expect(percentTall(pane.host)).toBe(50);
		expect(pane.host.hasAttribute(SHU_ATTR.DATA_COVERS_VIEWS)).toBe(true);
		pane.state.maximized = true;
		pane.dock.hostUpdate();
		expect(percentTall(pane.host), "maximized").toBe(100);
		pane.state.closed = true;
		pane.dock.hostUpdate();
		expect(percentTall(pane.host)).toBeUndefined();
		expect(pane.host.hasAttribute(SHU_ATTR.DATA_COVERS_VIEWS)).toBe(false);
	});

	it("holds none of it in the strip: a column neither takes a height nor covers the columns", () => {
		const pane = aDockedPane({ docked: false, closed: false });
		pane.dock.hostUpdate();
		expect(percentTall(pane.host)).toBeUndefined();
		expect(pane.host.hasAttribute(SHU_ATTR.DATA_COVERS_VIEWS)).toBe(false);
	});

	it("remembers a drag of its top edge as a share of its container, within the bounds", () => {
		const pane = aDockedPane({ closed: false });
		pane.dock.onResizeDown(pointer("pointerdown", 800));
		pane.sizes.pane = 950;
		document.dispatchEvent(pointer("pointerup", 50));
		expect(pane.state.height).toBe(PROPORTION.max);
		expect(percentTall(pane.host)).toBe(PROPORTION.max * 100);
	});

	it("closes on a click elsewhere, and stays open when pinned, when the click is inside it, or when the click picks an option of a combobox inside it", () => {
		const pane = aDockedPane({ closed: false, pinned: true });
		document.body.click();
		expect(pane.state.closed, "pinned").toBe(false);
		pane.state.pinned = false;
		const inside = document.createElement("button");
		pane.host.append(inside);
		inside.click();
		expect(pane.state.closed, "a click inside").toBe(false);
		const strip = document.createElement("div");
		strip.setAttribute(SHU_ATTR.DOCK_CONTROLS, "");
		document.body.append(strip);
		strip.click();
		expect(pane.state.closed, "a click on the controls of the docked pane").toBe(false);
		const holder = document.createElement("div");
		pane.host.append(holder);
		const chat = holder.attachShadow({ mode: "open" }).appendChild(document.createElement("section"));
		chat.append(document.createElement("shu-kihan-chat"));
		const options = document.createElement("ul");
		options.setAttribute("role", "listbox");
		options.dataset.comboOwner = "shu-kihan-chat";
		const option = document.createElement("li");
		options.append(option);
		document.body.append(options);
		option.click();
		expect(pane.state.closed, "an option of a combobox a view inside it holds").toBe(false);
		document.body.click();
		expect(pane.state.closed, "a click elsewhere").toBe(true);
	});

	it("reserves its closed strip's height on its positioning host as the strip changes, and releases it in the strip and when the pane goes", () => {
		const pane = aDockedPane();
		pane.sizes.pane = 40;
		rendered(pane);
		expect(pane.container.style.getPropertyValue(DOCK_FOOTPRINT), "closed, the pane is its strip").toBe("40px");
		pane.sizes.pane = 64;
		rendered(pane);
		expect(pane.container.style.getPropertyValue(DOCK_FOOTPRINT)).toBe("64px");
		pane.state.closed = false;
		pane.sizes.pane = 400;
		pane.sizes.header = 64;
		rendered(pane);
		expect(pane.container.style.getPropertyValue(DOCK_FOOTPRINT), "open, its header is the strip it closes to").toBe("64px");
		pane.state.docked = false;
		rendered(pane);
		expect(pane.container.style.getPropertyValue(DOCK_FOOTPRINT), "a pane returned to the strip").toBe("");
		pane.state.docked = true;
		rendered(pane);
		pane.host.disconnect();
		expect(pane.container.style.getPropertyValue(DOCK_FOOTPRINT), "a pane removed from the page").toBe("");
	});

	it("states itself as the docked pane as it opens, closes and is pinned, and withdraws that in the strip and when it goes", () => {
		const pane = aDockedPane();
		rendered(pane);
		expect(dockedPane.get()).toEqual({ key: "Docked", open: false, pinned: false });
		pane.state.closed = false;
		pane.state.pinned = true;
		rendered(pane);
		expect(dockedPane.get()).toEqual({ key: "Docked", open: true, pinned: true });
		pane.state.docked = false;
		rendered(pane);
		expect(dockedPane.get(), "a pane returned to the strip").toBeNull();
		pane.state.docked = true;
		rendered(pane);
		dockedPane.set({ key: "Other", open: true, pinned: false });
		pane.state.docked = false;
		rendered(pane);
		expect(dockedPane.get(), "a pane returned to the strip leaves another docked pane stated as it is").toEqual({ key: "Other", open: true, pinned: false });
		pane.state.docked = true;
		rendered(pane);
		pane.host.disconnect();
		expect(dockedPane.get(), "a pane removed from the page").toBeNull();
	});
});
