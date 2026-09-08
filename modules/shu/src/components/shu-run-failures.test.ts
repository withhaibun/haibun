// @vitest-environment jsdom
/**
 * The list of what a run failed at. It draws the rows it is given and moves the shared cursor to the one pressed;
 * which rows those are belongs to whoever gives them. Nothing is installed to test it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SHU_TAG } from "../consts.js";
import { timeCursor } from "../signals.js";
import type { TRunRow } from "../client-cache/run-window.js";
import { ShuRunFailures } from "./shu-run-failures.js";

if (!customElements.get(SHU_TAG.RUN_FAILURES)) customElements.define(SHU_TAG.RUN_FAILURES, ShuRunFailures);

const IDS = SHU_TEST_IDS.FAILURES;
const aFailedStep = (id: string, at: number, error: string): TRunRow => ({ kind: "step", step: id, id, at, level: "info", text: `step ${id}`, status: "failed", error }) as TRunRow;

const listOf = async (rows: TRunRow[]): Promise<ShuRunFailures> => {
	const list = new ShuRunFailures();
	list.rows = rows;
	document.body.append(list);
	await list.updateComplete;
	return list;
};
const rowsOf = (list: ShuRunFailures): Element[] => [...(list.shadowRoot?.querySelectorAll(`[data-testid^='${IDS.ROW}']`) ?? [])];

describe("the failures of a run, beside the bar", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		timeCursor.set(null);
	});

	it("lists one row per failure it was given, naming what failed and why", async () => {
		const list = await listOf([aFailedStep("1", 1000, "it would not run"), aFailedStep("2", 2000, "nor would it")]);
		expect(rowsOf(list).length).toBe(2);
		expect(list.shadowRoot?.textContent).toContain("it would not run");
	});

	it("says how many failed, which is what a reader reads before opening one", async () => {
		const list = await listOf([aFailedStep("1", 1000, "it would not run")]);
		expect(list.shadowRoot?.querySelector(`[data-testid='${IDS.COUNT}']`)?.textContent).toContain("1 failed");
	});

	it("draws nothing for a run that failed nothing, rather than an empty list", async () => {
		const list = await listOf([]);
		expect(list.shadowRoot?.querySelector(`[data-testid='${IDS.ROOT}']`)).toBeNull();
	});

	it("moves the shared cursor to the moment of the failure pressed, so every view scrubs there", async () => {
		const list = await listOf([aFailedStep("1", 1000, "it would not run"), aFailedStep("2", 2000, "nor would it")]);
		(rowsOf(list)[1] as HTMLElement).click();
		expect(timeCursor.get()).toBe(2000);
	});
});
