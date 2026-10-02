import { describe, expect, it } from "vitest";
import type { Page } from "playwright";

import WebPlaywright from "./web-playwright.js";

/** A stepper whose page is a stand-in, so the order of the actions run on it, and each time it is brought to the front, is
 *  all that is observed. */
function stepperOnOnePage() {
	const wp = new WebPlaywright();
	const fronted: string[] = [];
	const page = { bringToFront: () => Promise.resolve(void fronted.push("in front")) } as unknown as Page;
	wp.getPage = () => Promise.resolve(page);
	return Object.assign(wp, { fronted });
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

	it("brings the page to the front for each action, since a browser doesn't draw a page in a background tab", async () => {
		const wp = stepperOnOnePage();
		await wp.withPage(() => "first");
		await wp.withPage(() => "second");
		expect(wp.fronted).toEqual(["in front", "in front"]);
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
