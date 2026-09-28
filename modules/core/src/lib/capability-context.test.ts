/**
 * What a capability covers: the calls a step makes. It doesn't cover work that outlives it.
 *
 * The async context carries the capability down a call chain, which is what makes a step dispatched from inside
 * another run under the same authority. The same mechanism would carry it into work started during a step and left
 * running, so work that ticks on its own runs without one.
 */
import { describe, expect, it } from "vitest";
import { authorizedWith, readingAt, runAuthorizedWith, runReadingAt, runShowing, shownTo } from "./capability-context.js";

describe("the capability a step runs under", () => {
	it("is undefined outside a dispatch", () => {
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
		// What a ticker does: schedule work that outlives the step, and run it without a capability of its own.
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

describe("the steps a listing shows", () => {
	it("are those the caller holds, where it doesn't act for another caller", async () => {
		expect(await runAuthorizedWith("Read:public", () => Promise.resolve(shownTo()))).toBe("Read:public");
	});

	it("are those the caller it acts for holds, while what it may call stays its own", async () => {
		const seen = await runAuthorizedWith(["*"], () =>
			runShowing(authorizedWith(), () => runAuthorizedWith("Read:public", () => Promise.resolve({ shown: shownTo(), held: authorizedWith() }))),
		);
		expect(seen).toEqual({ shown: ["*"], held: "Read:public" });
	});
});

describe("the ceiling a read runs under", () => {
	it("is what the boundary set, and a read outside one isn't bounded", async () => {
		expect(readingAt(), "a feature line in its own run isn't bounded by a ceiling of its own").toBeUndefined();
		// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
		await runReadingAt("public", async () => {
			expect(readingAt()).toBe("public");
		});
		expect(readingAt(), "and it is gone once the call that set it is over").toBeUndefined();
	});

	it("is never widened by a scope inside it, which may only narrow it", async () => {
		// A model turn runs its tool calls under the level its context resolved at, inside the ceiling the web boundary set
		// for the caller. The turn's level may be wider than the caller's, and a read inside the turn stays within both.
		await runReadingAt("opened", async () => {
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt("private", async () => {
				expect(readingAt(), "asking for more than the ceiling reads at the ceiling").toBe("opened");
			});
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt("public", async () => {
				expect(readingAt(), "asking for less reads at less").toBe("public");
			});
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt(undefined, async () => {
				expect(readingAt(), "not stating a level keeps the ceiling in force").toBe("opened");
			});
		});
	});
});
