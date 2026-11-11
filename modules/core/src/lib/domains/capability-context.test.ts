/**
 * A capability covers the calls a step makes. It doesn't cover work that outlives the step.
 *
 * The async context carries the capability down a call chain. A step dispatched inside another step therefore runs
 * under the same authority. The same mechanism would carry the capability into work that a step starts and leaves
 * running. Work that ticks on its own therefore runs under a capability it sets instead of the step's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	actsAsItself,
	callerAt,
	delegatorOf,
	inCall,
	inStep,
	mayRun,
	nestedOf,
	readingAt,
	WITHOUT_READ_REFUSAL,
	runAuthorizedWith,
	runInCall,
	runReadingAt,
	shownTo,
	type TCallContext,
} from "./capability-context.js";
import { ActionSchema, readAction } from "./actions.js";
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

/** The record of a delegation a proof presents. */
const DELEGATION = { label: "Capability", id: "urn:c" };

describe("the record of an outside caller", () => {
	const READ = [readAction(Access.public)];
	it.each([
		[
			"invokes what its request presented, and holds what its chain allows",
			{ held: ["*"], capabilityAction: ["A:run"], principal: "did:a" },
			{ capabilityAction: ["A:run"], held: ["*"], principal: "did:a" },
		],
		["invokes what it holds where its request doesn't state a narrower action", { held: READ, principal: undefined }, { capabilityAction: READ, held: READ }],
		[
			"rests on the capabilities its proof states, under the delegation its proof presents",
			{ held: READ, principal: "did:a", restsOn: { capabilities: ["urn:c"], delegation: DELEGATION } },
			{ restsOn: { capabilities: ["urn:c"], delegation: DELEGATION }, delegation: DELEGATION },
		],
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
		["holds what the caller holds, as the caller", nestedOf(call), { held: ["*"], principal: "did:a", outside: true }],
		["keeps the read scope in force as the statement's scope", nestedOf(call), { stated: { scope: call.readScope }, readScope: call.readScope }],
		[
			"is inside the step, whose call's first step stays outermost",
			nestedOf(inStep(call, { seqPath: "0.1", reportsAt: undefined }), { seqPath: "0.1.1", reportsAt: undefined }),
			{ step: { seqPath: "0.1.1", reportsAt: undefined, outermost: "0.1" } },
		],
	])("%s", (_, nested, expected) => {
		expect(nested).toMatchObject(expected);
	});

	it("doesn't state a capabilityAction, since a caller didn't name it", () => {
		expect(nestedOf(call)).not.toHaveProperty("capabilityAction");
	});

	it("doesn't state the agent the call is attributed with, which made the call and not the work beneath it", () => {
		expect(nestedOf({ ...call, attributedTo: "a-model", delegation: DELEGATION })).toMatchObject({ delegation: DELEGATION });
		expect(nestedOf({ ...call, attributedTo: "a-model" })).not.toHaveProperty("attributedTo");
	});

	it("reads at the broadest read a narrower holding allows", () => {
		const narrowed = { ...call, held: [readAction(Access.public)] };
		expect(nestedOf(narrowed).readScope).toEqual({ ceiling: Access.public, from: narrowed.held });
	});
});

describe("the gate of a dispatched step", () => {
	const ENSURE = ActionSchema.parse("Activities:ensure");
	const WAYPOINT = ActionSchema.parse("Activities:applyWaypoint");
	const entry = (capabilityAction: string[], held: string[]): TCallContext => callerAt({ capabilityAction, held, principal: "did:a" });
	const nested = (held: string[]): TCallContext => nestedOf(entry([ENSURE], held), { seqPath: "0.1", reportsAt: undefined });
	it.each([
		["runs the step a call names under the action it presented", entry([ENSURE], ["*"]), ENSURE, undefined],
		["refuses the step a call names where the presented action doesn't allow it, though the caller holds it", entry([WAYPOINT], ["*"]), ENSURE, ENSURE],
		["runs a nested step under the held action that allows it", nested(["*"]), WAYPOINT, undefined],
		["refuses a nested step the caller's chain doesn't allow, and names the action it lacks", nested([ENSURE]), WAYPOINT, WAYPOINT],
		["refuses a step to a call that doesn't hold an action", undefined, ENSURE, ENSURE],
	])("%s", (_, call, capability, lacked) => {
		expect(mayRun(call, { capability })).toBe(lacked);
	});

	it("refuses a nested step that reads above the caller's read, and names the read", () => {
		expect(mayRun(nested([WAYPOINT, readAction(Access.public)]), { capability: WAYPOINT, readsAt: Access.private })).toBe(readAction(Access.private));
	});
});

describe("actuality acting as itself", () => {
	it.each([
		["holds every action without an outside caller", { held: ["*"] }, true],
		["isn't an outside caller that holds every action", callerAt({ held: ["*"], principal: "did:a" }), false],
		["isn't a statement that holds less than every action", { held: [readAction(Access.public)] }, false],
	])("%s", (_, call, itself) => {
		expect(actsAsItself(call)).toBe(itself);
	});

	it("presents its own delegation elsewhere, and an outside caller presents only its own delegation to the instance's key", () => {
		expect(delegatorOf({ held: ["*"] })).toBeUndefined();
		expect(delegatorOf(callerAt({ held: ["*"], principal: "did:a" }))).toBe("did:a");
		expect(() => delegatorOf(callerAt({ held: ["*"], principal: undefined })), "a caller that didn't prove a key").toThrow(/didn't prove a key/);
	});
});

describe("the call record", () => {
	it("is held by one store, and a dispatch context doesn't hold authority", () => {
		const source = readFileSync(new URL("./capability-context.ts", import.meta.url), "utf8");
		expect(source.match(/new AsyncLocalStorage/g)).toHaveLength(1);
		expectTypeOf<keyof DispatchContext>().toEqualTypeOf<"registry" | "world" | "steppers">();
	});
});
