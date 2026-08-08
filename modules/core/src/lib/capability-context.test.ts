/**
 * What a capability covers: the calls a step makes, and nothing that outlives it.
 *
 * The async context carries the capability down a call chain, which is what makes a step dispatched from inside
 * another run under the same authority. The same mechanism would carry it into work started during a step and left
 * running, so anything that ticks on its own runs with none.
 */
import { describe, expect, it } from "vitest";
import { authorizedWith, readingAt, runAuthorizedWith, runReadingAt } from "./capability-context.js";

describe("the capability a step runs under", () => {
	it("is nothing outside a dispatch", () => {
		expect(authorizedWith()).toBeUndefined();
	});

	it("reaches the calls the step makes, including asynchronous ones", async () => {
		const seen = await runAuthorizedWith("Instance:run", async () => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return authorizedWith();
		});
		expect(seen).toBe("Instance:run");
	});

	it("ends with the step, so a later call is authorized on its own terms", async () => {
		await runAuthorizedWith("Instance:run", () => Promise.resolve(undefined));
		expect(authorizedWith()).toBeUndefined();
	});

	it("is not carried by work started during a step and left to run", async () => {
		let ticked: string | string[] | undefined = "unset";
		// What a ticker does: schedule work that outlives the step, and run it with no capability of its own.
		await runAuthorizedWith("Instance:run", () => {
			setTimeout(() => void runAuthorizedWith(undefined, () => Promise.resolve(void (ticked = authorizedWith()))), 1);
			return Promise.resolve();
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(ticked, "a timer left running would otherwise hold the authority of whoever started it").toBeUndefined();
	});

	it("nests: an inner call may run under a narrower capability without changing the outer one", async () => {
		await runAuthorizedWith("Instance:run", async () => {
			await runAuthorizedWith("Instance:read", async () => expect(authorizedWith()).toBe("Instance:read"));
			expect(authorizedWith()).toBe("Instance:run");
		});
	});
});

describe("the ceiling a read runs under", () => {
	it("is what the boundary set, and nothing outside one is bounded", async () => {
		expect(readingAt(), "a feature line in its own run is bounded by nothing of its own").toBeUndefined();
		await runReadingAt("public", async () => {
			expect(readingAt()).toBe("public");
			await runReadingAt("private", async () => {
				expect(readingAt(), "an inner scope states its own, and the store meets the two").toBe("private");
			});
		});
		expect(readingAt(), "and it is gone once the call that set it is over").toBeUndefined();
	});
});
