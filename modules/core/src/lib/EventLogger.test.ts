import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventLogger } from "./EventLogger.js";
import { TFeatureStep } from "./astepper.js";
import { OBSCURED_VALUE } from "./feature-variables.js";
import { BlipEvent, ImageArtifact, LogEvent, type THaibunEvent } from "../schema/protocol.js";
import { runAuthorizedWith, runInStep, runReadingAt } from "./capability-context.js";
import { readAction, writeAction } from "./actions.js";
import { Access } from "./resources.js";
import { itemAt } from "./util/item-at.js";

const OK = { ok: true as const };

describe("EventLogger", () => {
	let logger: EventLogger;

	beforeEach(() => {
		logger = new EventLogger((name: string) => name === "password" || name === "apiKey");
		logger.suppressConsole = true;
	});

	describe("obscure secret values", () => {
		// The mock is partial, so it is cast through unknown to TFeatureStep.
		const mockFeatureStep = {
			source: { path: "/test/feature.ts", lineNumber: 1 },
			in: 'set password to "secret123"',
			seqPath: [1, 1, 1],
			action: { actionName: "set", stepperName: "VariablesStepper", step: { gwta: "set {what} to {value}", action: async () => OK } },
		} as unknown as TFeatureStep;

		it("should obscure secret values in stepStart", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = {
				password: { term: "password", value: "secret123", domain: "string", origin: "var" },
				username: { term: "username", value: "testuser", domain: "string", origin: "var" },
			};

			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, stepValuesMap);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
			expect(event.stepValuesMap).toBeDefined();
			expect(event.stepValuesMap?.password?.value).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.username?.value).toBe("testuser");
		});

		it("should obscure secret values in stepEnd", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = {
				apiKey: { term: "apiKey", value: "key-abc-123", domain: "string", origin: "var" },
				count: { term: "count", value: "42", domain: "string", origin: "var" },
			};

			logger.stepEnd(mockFeatureStep, "VariablesStepper", "set", "completed", undefined, {}, stepValuesMap, undefined);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
			expect(event.stepValuesMap).toBeDefined();
			expect(event.stepValuesMap?.apiKey?.value).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.count?.value).toBe("42");
		});

		it("should not obscure a value when isSecretFn returns false for every name", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = { password: { term: "password", value: "secret123", domain: "string", origin: "var" } };

			logger = new EventLogger(() => false);
			logger.suppressConsole = true;
			logger.subscribe((event) => emitted.push(event));
			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, stepValuesMap);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
			expect(event.stepValuesMap?.password?.value).toBe("secret123");
		});

		it("should handle an undefined stepValuesMap", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, undefined);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, unknown> };
			expect(event.stepValuesMap).toBeUndefined();
		});

		it("should handle primitive values in stepValuesMap", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = { password: "secret123", username: "testuser" };

			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, stepValuesMap);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, unknown> };
			expect(event.stepValuesMap?.password).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.username).toBe("testuser");
		});
	});

	describe("the error a step's end event states", () => {
		const step = { source: { path: "/test/feature.ts", lineNumber: 1 }, in: "set count to 1", seqPath: [1, 1, 1] } as unknown as TFeatureStep;

		it("doesn't state an error for a step that didn't fail, so a view doesn't show one", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			logger.stepEnd(step, "VariablesStepper", "set", "completed", undefined, {}, undefined, undefined);

			const event = emitted[0] as { status?: string; error?: unknown };
			expect(event.status).toBe("completed");
			expect(event.error, "errorDetail(undefined) returns the string `undefined`, which a view would show as an error").toBeUndefined();
		});

		it("states the error of a step that failed", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			logger.stepEnd(step, "VariablesStepper", "set", "failed", new Error("the variable isn't set"), {}, undefined, undefined);

			const event = emitted[0] as { status?: string; error?: unknown };
			expect(event.status).toBe("failed");
			expect(event.error).toBe("the variable isn't set");
		});
	});

	describe("subscribe/unsubscribe", () => {
		it("should stop receiving events after unsubscribe", () => {
			const emitted: unknown[] = [];
			const callback = (event: unknown) => emitted.push(event);
			logger.subscribe(callback);
			logger.info("before");
			expect(emitted.length).toBe(1);

			logger.unsubscribe(callback);
			logger.info("after");
			expect(emitted.length).toBe(1);
		});

		it("should remove every count of a repeated subscription on one unsubscribe, so per-kind counts stay correct", () => {
			const callback = () => undefined;
			logger.subscribe(callback);
			logger.subscribe(callback);
			expect(logger.hasSubscribers("log")).toBe(true);
			logger.unsubscribe(callback);
			expect(logger.hasSubscribers("log")).toBe(false);
		});

		it("should support multiple subscribers independently", () => {
			const emittedA: unknown[] = [];
			const emittedB: unknown[] = [];
			const callbackA = (event: unknown) => emittedA.push(event);
			const callbackB = (event: unknown) => emittedB.push(event);

			logger.subscribe(callbackA);
			logger.subscribe(callbackB);
			logger.info("both");
			expect(emittedA.length).toBe(1);
			expect(emittedB.length).toBe(1);

			logger.unsubscribe(callbackA);
			logger.info("only B");
			expect(emittedA.length).toBe(1);
			expect(emittedB.length).toBe(2);
		});
	});

	describe("kinds delivery", () => {
		const blip = (name = "haibun.test.blip") => BlipEvent.parse({ id: "0.1.blip", timestamp: Date.now(), kind: "blip", level: "trace", emitter: "test", name });

		it("delivers narration to a subscriber without options, and never a blip", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // so emit doesn't return early for the blip
			logger.emit(blip());
			logger.info("narration");
			expect(emitted.map((e) => (e as { kind: string }).kind)).toEqual(["log"]);
		});

		it("delivers only the listed kinds to a subscriber that lists kinds, and only such a subscriber receives blips", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event), { kinds: ["blip"] });
			logger.emit(blip());
			logger.info("narration");
			expect(emitted.map((e) => (e as { kind: string }).kind)).toEqual(["blip"]);
		});

		it("filters blips by declared name, exact or by dotted namespace", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event), { kinds: ["blip"], names: ["haibun.http", "haibun.shu.view.scroll_adjust"] });
			logger.emit(blip("haibun.http.request")); // namespace match
			logger.emit(blip("haibun.shu.view.scroll_adjust")); // exact match
			logger.emit(blip("haibun.httpx.request")); // a name that starts with the text haibun.http isn't in the haibun.http namespace
			logger.emit(blip("haibun.shu.view.scroll_adjust_other"));
			expect(emitted.map((e) => (e as { name: string }).name)).toEqual(["haibun.http.request", "haibun.shu.view.scroll_adjust"]);
		});

		it("evaluates hasSubscribers per name, so the recording site skips a blip without a matching subscriber", () => {
			logger.subscribe(() => undefined, { kinds: ["blip"], names: ["haibun.http"] });
			expect(logger.hasSubscribers("blip", "haibun.http.request")).toBe(true);
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(false);
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // a blip subscriber without names receives a blip of every name
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(true);
		});

		it("counts subscribers per kind, so a recording site can skip recording with one check", () => {
			expect(logger.hasSubscribers("blip")).toBe(false);
			logger.subscribe(() => undefined); // a subscriber without options doesn't receive blips
			expect(logger.hasSubscribers("blip")).toBe(false);
			expect(logger.hasSubscribers("log")).toBe(true);
			const cb = () => undefined;
			logger.subscribe(cb, { kinds: ["blip"] });
			expect(logger.hasSubscribers("blip")).toBe(true);
			logger.unsubscribe(cb);
			expect(logger.hasSubscribers("blip")).toBe(false);
		});

		it("never prints a blip to the console", () => {
			const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
			try {
				logger.suppressConsole = false;
				logger.subscribe(() => undefined, { kinds: ["blip"] });
				logger.emit(blip());
				expect(consoleLog).not.toHaveBeenCalled();
				logger.info("narration");
				expect(consoleLog).toHaveBeenCalledTimes(1);
			} finally {
				consoleLog.mockRestore();
			}
		});
	});
	describe("the level of a log statement", () => {
		/** A step that reports at trace, as a call made into a running instance does. */
		const DURING_A_TRACE_STEP = { seqPath: "0.1", reportsAt: "trace" as const };
		const said = (): Array<Record<string, unknown>> => {
			const heard: Array<Record<string, unknown>> = [];
			logger.subscribe((e) => heard.push(e as unknown as Record<string, unknown>), { kinds: ["log"] });
			return heard;
		};

		it("reports at its own level outside a step", () => {
			const heard = said();
			logger.info("actuality reports something");
			expect(itemAt(heard, 0).level).toBe("info");
		});

		it("reports at most at the level of the step in flight, so a call into a running instance stays out of actuality's history", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => logger.info("what the caller's own step logged"));
			expect(itemAt(heard, 0).level, "logged during a step that reports at trace").toBe("trace");
		});

		it("keeps the level of a statement quieter than its step", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => logger.debug("quieter than the step"));
			expect(itemAt(heard, 0).level).toBe("debug");
		});

		it("reports a warning and an error at their own levels during a quieter step", () => {
			const heard = said();
			runInStep(DURING_A_TRACE_STEP, () => {
				logger.warn("something is wrong");
				logger.error("something failed");
			});
			expect(heard.map((e) => e.level)).toEqual(["warn", "error"]);
		});
	});
});

describe("the level of an artifact", () => {
	it("keeps the level its schema sets, whether its step is a substep or not", () => {
		const emitted: Array<{ level?: string }> = [];
		const logger = new EventLogger();
		logger.suppressConsole = true;
		logger.subscribe((event) => emitted.push(event as { level?: string }), { kinds: ["artifact"] });
		const step = (isSubStep: boolean): TFeatureStep =>
			({ in: "take a screenshot", seqPath: [0, 1, 2], action: { stepperName: "S", actionName: "a", stepValuesMap: {} }, isSubStep }) as unknown as TFeatureStep;
		// A producer parses an artifact with its schema, which sets the level to info by default.
		logger.artifact(step(true), ImageArtifact.parse({ kind: "artifact", artifactType: "image", path: "a.png", id: "x", timestamp: 1 }) as never);
		logger.artifact(step(false), ImageArtifact.parse({ kind: "artifact", artifactType: "image", path: "b.png", id: "y", timestamp: 2 }) as never);
		expect(
			emitted.map((e) => (e as { level?: string }).level),
			"an artifact isn't capped at its step's level",
		).toEqual(["info", "info"]);
	});
});

describe("the level an event states", () => {
	const said = (message: string) => LogEvent.parse({ id: message, timestamp: 0, kind: "log", level: "info", message });

	it("is a level stated at emit, or else the read level of the call that emitted it: public for a call bounded to public reads, private for actuality's own event", async () => {
		const logger = new EventLogger();
		logger.suppressConsole = true;
		const levels: Record<string, unknown> = {};
		logger.subscribe((event: THaibunEvent) => void (levels[event.id] = event.accessLevel));
		await runReadingAt(Access.public, () => Promise.resolve(logger.emit(said("bounded"))));
		logger.emit(said("actuality's own"));
		logger.emit({ ...said("stated"), accessLevel: Access.opened });
		expect(levels).toEqual({ bounded: Access.public, "actuality's own": Access.private, stated: Access.opened });
	});

	it("is rejected where it is more public than the call's read level and the call doesn't hold that level's write action", async () => {
		const logger = new EventLogger();
		logger.suppressConsole = true;
		const reader = [readAction(Access.private)];
		const announce = () => runAuthorizedWith(reader, () => runReadingAt(Access.private, async () => logger.emit({ ...said("published"), accessLevel: Access.public })));
		await expect(announce()).rejects.toThrow(writeAction(Access.public));
	});
});
