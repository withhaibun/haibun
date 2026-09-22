import { describe, expect, it } from "vitest";
import type { Page } from "playwright";

import WebPlaywright from "./web-playwright.js";

/** A stepper whose page is a stand-in, so the order of the actions run on it is all that is observed. */
function stepperOnOnePage() {
	const wp = new WebPlaywright();
	const page = {} as Page;
	wp.getPage = () => Promise.resolve(page);
	return wp;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("withPage", () => {
	it("runs one action at a time on a page that several callers share", async () => {
		const wp = stepperOnOnePage();
		const order: string[] = [];
		const act = (name: string) =>
			wp.withPage(async () => {
				order.push(`${name} starts`);
				await tick();
				order.push(`${name} ends`);
			});
		await Promise.all([act("first"), act("second")]);
		expect(order).toEqual(["first starts", "first ends", "second starts", "second ends"]);
	});

	it("runs an action nested in another at once, rather than behind it", async () => {
		const wp = stepperOnOnePage();
		const nested = await wp.withPage(() => wp.withPage(() => "nested ran"));
		expect(nested).toBe("nested ran");
	});

	it("runs the next action after one that failed", async () => {
		const wp = stepperOnOnePage();
		const failed = wp.withPage(() => Promise.reject(new Error("the action failed")));
		const next = wp.withPage(() => "next ran");
		await expect(failed).rejects.toThrow("the action failed");
		expect(await next).toBe("next ran");
	});
});
