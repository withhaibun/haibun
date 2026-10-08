/**
 * A capability covers the calls a step makes. It doesn't cover work that outlives the step.
 *
 * The async context carries the capability down a call chain. A step dispatched inside another step therefore runs
 * under the same authority. The same mechanism would carry the capability into work that a step starts and leaves
 * running. Work that ticks on its own therefore runs under a capability it sets instead of the step's.
 */
import { describe, expect, it } from "vitest";
import { authorizedWith, readingAt, runActingAs, runAuthorizedWith, runInStep, runReadingAt, runShowing, shownTo, stepInFlight } from "./capability-context.js";

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

	it("ends with the step, so a later call doesn't inherit it", async () => {
		await runAuthorizedWith("Instance:run", () => Promise.resolve(undefined));
		expect(authorizedWith()).toBeUndefined();
	});

	it("is replaced in work that a step starts and leaves running", async () => {
		let ticked: string | string[] | undefined = "unset";
		// The timer schedules work that outlives the step. That work sets an undefined capability, as a tick sets its own.
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

	it("are those another caller holds where the caller acts for it, and the caller still calls only what it holds", async () => {
		const seen = await runAuthorizedWith(["*"], () =>
			runShowing(authorizedWith(), () => runAuthorizedWith("Read:public", () => Promise.resolve({ shown: shownTo(), held: authorizedWith() }))),
		);
		expect(seen).toEqual({ shown: ["*"], held: "Read:public" });
	});
});

describe("the ceiling a read runs under", () => {
	it("is what the boundary set, and a read outside one isn't bounded", async () => {
		expect(readingAt(), "a line of actuality's own features isn't bounded by a ceiling").toBeUndefined();
		// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
		await runReadingAt("public", async () => {
			expect(readingAt()).toBe("public");
		});
		expect(readingAt(), "and the ceiling ends with the call that set it").toBeUndefined();
	});

	it("isn't widened by a scope inside it, and an inner scope may only narrow it", async () => {
		// A model turn runs its tool calls at its context's resolved level, inside the ceiling the web boundary set for the
		// caller. The turn's level may be wider than the caller's ceiling. A read inside the turn stays within both.
		await runReadingAt("opened", async () => {
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt("private", async () => {
				expect(readingAt(), "a read scoped above the ceiling reads at the ceiling").toBe("opened");
			});
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt("public", async () => {
				expect(readingAt(), "a read scoped below the ceiling reads at its own level").toBe("public");
			});
			// biome-ignore lint/suspicious/useAwait: runReadingAt takes a () => Promise<T>, and the scope doesn't await a promise
			await runReadingAt(undefined, async () => {
				expect(readingAt(), "a scope that doesn't state a level keeps the ceiling in force").toBe("opened");
			});
		});
	});
});

describe("the outermost step of a call", () => {
	const step = (seqPath: string) => ({ seqPath, reportsAt: undefined });

	it("is the call's first step, for every step inside the call", () => {
		const inner = runInStep(step("0.1"), () => runInStep(step("0.1.1"), () => stepInFlight()));
		expect(inner).toEqual({ seqPath: "0.1.1", reportsAt: undefined, outermost: "0.1" });
	});

	it("begins again where a call proves its principal, since that call isn't part of the step during which it arrived", async () => {
		const arrived = await runInStep(step("0.1"), () => runActingAs("did:example:caller", () => Promise.resolve(runInStep(step("0.9"), () => stepInFlight()))));
		expect(arrived?.outermost).toBe("0.9");
	});
});
