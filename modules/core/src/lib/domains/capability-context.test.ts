/**
 * A capability covers the calls a step makes. It doesn't cover work that outlives the step.
 *
 * The async context carries the capability down a call chain. A step dispatched inside another step therefore runs
 * under the same authority. The same mechanism would carry the capability into work that a step starts and leaves
 * running. Work that ticks on its own therefore runs under a capability it sets instead of the step's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { callerAt, inCall, inStep, nestedOf, readingAt, WITHOUT_READ_REFUSAL, runAuthorizedWith, runInCall, runReadingAt, shownTo } from "./capability-context.js";
import { readAction } from "./actions.js";
import { Access } from "./resources.js";
import type { DispatchContext } from "../actuality/pipelines/step-dispatch.js";

describe("the capability a step runs under", () => {
	it("is undefined outside a dispatch", () => {
		expect(inCall()?.capabilityAction).toBeUndefined();
	});

	it("reaches the calls the step makes, including asynchronous ones", async () => {
		const seen = await runAuthorizedWith("Instance:run", async () => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return inCall()?.capabilityAction;
		});
		expect(seen).toBe("Instance:run");
	});

	it("ends with the step, so a later call doesn't inherit it", async () => {
		await runAuthorizedWith("Instance:run", () => Promise.resolve(undefined));
		expect(inCall()?.capabilityAction).toBeUndefined();
	});

	it("is replaced in work that a step starts and leaves running", async () => {
		let ticked: string | string[] | undefined = "unset";
		// The timer schedules work that outlives the step. That work sets an undefined capability, as a tick sets its own.
		await runAuthorizedWith("Instance:run", () => {
			setTimeout(() => void runAuthorizedWith(undefined, () => Promise.resolve(void (ticked = inCall()?.capabilityAction))), 1);
			return Promise.resolve();
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(ticked, "a timer left running would otherwise hold the authority of whoever started it").toBeUndefined();
	});

	it("nests: an inner call may run under a narrower capability without changing the outer one", async () => {
		await runAuthorizedWith("Instance:run", async () => {
			await runAuthorizedWith("Instance:read", async () => expect(inCall()?.capabilityAction).toBe("Instance:read"));
			expect(inCall()?.capabilityAction).toBe("Instance:run");
		});
	});
});

describe("the steps a listing shows", () => {
	it("are those the caller holds, where it doesn't act for another caller", async () => {
		expect(await runAuthorizedWith("Read:public", () => Promise.resolve(shownTo()))).toBe("Read:public");
	});

	it("are those another caller holds where the caller acts for it, and the caller still calls only what it holds", async () => {
		const seen = await runAuthorizedWith(["*"], () =>
			runInCall({ ...inCall(), shown: inCall()?.capabilityAction }, () =>
				runAuthorizedWith("Read:public", () => Promise.resolve({ shown: shownTo(), held: inCall()?.capabilityAction })),
			),
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
		const inner = runInCall(inStep(inCall(), step("0.1")), () => runInCall(inStep(inCall(), step("0.1.1")), () => inCall()?.step));
		expect(inner).toEqual({ seqPath: "0.1.1", reportsAt: undefined, outermost: "0.1" });
	});

	it("begins again where a call proves its principal, since that call isn't part of the step during which it arrived", async () => {
		const arrived = await runInCall(inStep(inCall(), step("0.1")), () =>
			runInCall({ ...inCall(), principal: "did:example:caller", step: undefined }, () => Promise.resolve(runInCall(inStep(inCall(), step("0.9")), () => inCall()?.step))),
		);
		expect(arrived?.outermost).toBe("0.9");
	});
});

describe("a caller a boundary states", () => {
	it("replaces the authority, the principal and the read scope of the code that reached the boundary", async () => {
		const held = [readAction(Access.public)];
		const seen = await runAuthorizedWith(["*"], () =>
			runReadingAt(undefined, () =>
				runInCall({ ...inCall(), principal: "did:example:instance", step: undefined }, () =>
					runInCall(callerAt({ held, principal: "did:example:wallet" }), async () => ({
						authorized: inCall()?.capabilityAction,
						held: inCall()?.held,
						as: inCall()?.principal,
						at: readingAt(),
					})),
				),
			),
		);
		expect(seen).toEqual({ authorized: held, held, as: "did:example:wallet", at: Access.public });
	});

	it("refuses each read where the caller doesn't hold one", async () => {
		await expect(runInCall(callerAt({ held: [], principal: undefined }), async () => readingAt())).rejects.toThrow(/requires a read action/);
	});
});

describe("the record of an outside caller", () => {
	const READ = [readAction(Access.public)];
	it.each([
		[
			"invokes what its request presented, and holds what its chain allows",
			{ held: ["*"], capabilityAction: ["A:run"], principal: "did:a" },
			{ capabilityAction: ["A:run"], held: ["*"], principal: "did:a" },
		],
		["invokes what it holds where its request doesn't state a narrower action", { held: READ, principal: undefined }, { capabilityAction: READ, held: READ }],
		["rests on the capabilities its proof states", { held: READ, principal: "did:a", restsOn: { capabilities: ["urn:c"] } }, { restsOn: { capabilities: ["urn:c"] } }],
	])("%s", (_, caller, expected) => {
		expect(callerAt(caller)).toMatchObject({ ...expected, outside: true });
	});

	it("reads at the broadest read it holds, and is refused each read where it doesn't hold one", () => {
		expect(callerAt({ held: READ, principal: undefined }).readScope).toEqual({ ceiling: Access.public, from: READ });
		expect(() => runInCall(callerAt({ held: [], principal: undefined }), readingAt)).toThrow(WITHOUT_READ_REFUSAL);
	});

	it("doesn't carry the step, the ask or the statement of the code that reached the boundary", () => {
		const reached = inStep({ ask: "ask-1", stated: { scope: undefined }, held: ["*"] }, { seqPath: "0.1", reportsAt: undefined });
		expect(runInCall(reached, () => callerAt({ held: READ, principal: undefined }))).not.toHaveProperty("step");
	});
});

describe("the record of a step dispatched beneath another", () => {
	const call = callerAt({ held: ["*"], capabilityAction: ["A:run"], principal: "did:a" });
	it.each([
		["invokes from what the caller holds", nestedOf(call), { capabilityAction: ["*"], held: ["*"], principal: "did:a", outside: true }],
		["keeps the read scope in force as the statement's scope", nestedOf(call), { stated: { scope: call.readScope }, readScope: call.readScope }],
		[
			"is inside the step, whose call's first step stays outermost",
			nestedOf(inStep(call, { seqPath: "0.1", reportsAt: undefined }), { seqPath: "0.1.1", reportsAt: undefined }),
			{ step: { seqPath: "0.1.1", reportsAt: undefined, outermost: "0.1" } },
		],
	])("%s", (_, nested, expected) => {
		expect(nested).toMatchObject(expected);
	});

	it("doesn't state the agent the call is attributed with, which made the call and not the work beneath it", () => {
		expect(nestedOf({ ...call, attributedTo: "a-model", delegation: "urn:d" })).toMatchObject({ delegation: "urn:d" });
		expect(nestedOf({ ...call, attributedTo: "a-model" })).not.toHaveProperty("attributedTo");
	});

	it("reads at the broadest read a narrower holding allows", () => {
		const narrowed = { ...call, held: [readAction(Access.public)] };
		expect(nestedOf(narrowed).readScope).toEqual({ ceiling: Access.public, from: narrowed.held });
	});
});

describe("the call record", () => {
	it("is held by one store, and a dispatch context doesn't hold authority", () => {
		const source = readFileSync(new URL("./capability-context.ts", import.meta.url), "utf8");
		expect(source.match(/new AsyncLocalStorage/g)).toHaveLength(1);
		expectTypeOf<keyof DispatchContext>().toEqualTypeOf<"registry" | "world" | "steppers">();
	});
});
