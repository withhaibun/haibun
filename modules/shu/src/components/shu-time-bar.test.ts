// @vitest-environment jsdom
/**
 * The bar a reader reads the shape of a run from. It draws the marks it is given and says which division was pressed;
 * what those marks are, and what pressing one moves, are its readers' to decide. Nothing is installed to test it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MARK_COLOUR } from "../event-marker.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SHU_TAG } from "../consts.js";
import { ShuTimeBar } from "./shu-time-bar.js";

if (!customElements.get(SHU_TAG.TIME_BAR)) customElements.define(SHU_TAG.TIME_BAR, ShuTimeBar);

const barWith = async (marks: Array<{ division: number; color: string; icon: string }>, divisions: number): Promise<ShuTimeBar> => {
	const bar = new ShuTimeBar();
	bar.divisions = divisions;
	bar.marks = marks;
	document.body.append(bar);
	await bar.updateComplete;
	return bar;
};

const drawn = (bar: ShuTimeBar): Element[] => [...(bar.shadowRoot?.querySelectorAll(`[data-testid^='${SHU_TEST_IDS.TIME_BAR.MARK}']`) ?? [])];

describe("the bar a run's shape is read from", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("draws one mark per division it was given, and none for the divisions holding nothing", async () => {
		const bar = await barWith([{ division: 0, color: MARK_COLOUR.ok, icon: "o" }, { division: 3, color: MARK_COLOUR.fault, icon: "x" }], 4);
		expect(drawn(bar).length).toBe(2);
	});

	it("places a mark along its span by which division it is, so a reader sees where in the run it falls", async () => {
		const bar = await barWith([{ division: 0, color: MARK_COLOUR.ok, icon: "o" }, { division: 9, color: MARK_COLOUR.ok, icon: "o" }], 10);
		const [first, last] = drawn(bar).map((el) => Number.parseFloat((el as HTMLElement).style.left));
		expect(first).toBeLessThan(last);
		expect(first).toBeGreaterThanOrEqual(0);
		expect(last).toBeLessThanOrEqual(100);
	});

	it("names each mark by its division, so a reader waiting for one names which", async () => {
		const bar = await barWith([{ division: 7, color: MARK_COLOUR.fault, icon: "x" }], 10);
		expect(drawn(bar)[0].getAttribute("data-testid")).toBe(`${SHU_TEST_IDS.TIME_BAR.MARK}7`);
	});

	it("says which division was pressed, leaving what that moves to whoever is listening", async () => {
		const bar = await barWith([{ division: 2, color: MARK_COLOUR.fault, icon: "x" }], 4);
		let pressed: number | undefined;
		bar.addEventListener("time-bar-press", (e) => {
			pressed = (e as CustomEvent<{ division: number }>).detail.division;
		});
		(drawn(bar)[0] as HTMLElement).click();
		expect(pressed).toBe(2);
	});

	it("draws nothing for a run whose shape is not known yet, rather than an empty frame", async () => {
		const bar = await barWith([], 10);
		expect(drawn(bar).length).toBe(0);
	});
});
