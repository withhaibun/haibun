import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventLogger } from "./EventLogger.js";
import { TFeatureStep } from "./astepper.js";
import { OBSCURED_VALUE } from "./feature-variables.js";
import { BlipEvent } from "../schema/protocol.js";

const OK = { ok: true as const };

describe("EventLogger", () => {
	let logger: EventLogger;

	beforeEach(() => {
		logger = new EventLogger((name: string) => name === "password" || name === "apiKey");
		logger.suppressConsole = true;
	});

	describe("obscure secret values", () => {
		// Use 'as TFeatureStep' to bypass full type checking for test mock
		const mockFeatureStep = {
			source: { path: "/test/feature.ts", lineNumber: 1 },
			in: 'set password to "secret123"',
			seqPath: [1, 1, 1],
			action: {
				actionName: "set",
				stepperName: "VariablesStepper",
				step: {
					gwta: "set {what} to {value}",
					action: async () => OK,
				},
			},
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
			expect(event.stepValuesMap?.password.value).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.username.value).toBe("testuser");
		});

		it("should obscure secret values in stepEnd", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = {
				apiKey: { term: "apiKey", value: "key-abc-123", domain: "string", origin: "var" },
				count: { term: "count", value: "42", domain: "string", origin: "var" },
			};

			logger.stepEnd(mockFeatureStep, "VariablesStepper", "set", true, undefined, {}, stepValuesMap, undefined);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
			expect(event.stepValuesMap).toBeDefined();
			expect(event.stepValuesMap?.apiKey.value).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.count.value).toBe("42");
		});

		it("should not obscure when isSecretFn returns false for all", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			const stepValuesMap = {
				password: { term: "password", value: "secret123", domain: "string", origin: "var" },
			};

			logger = new EventLogger(() => false);
			logger.suppressConsole = true;
			logger.subscribe((event) => emitted.push(event));
			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, stepValuesMap);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
			expect(event.stepValuesMap?.password.value).toBe("secret123");
		});

		it("should handle null stepValuesMap", () => {
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

			const stepValuesMap = {
				password: "secret123",
				username: "testuser",
			};

			logger.stepStart(mockFeatureStep, "VariablesStepper", "set", {}, stepValuesMap);

			expect(emitted.length).toBe(1);
			const event = emitted[0] as { stepValuesMap?: Record<string, unknown> };
			expect(event.stepValuesMap?.password).toBe(OBSCURED_VALUE);
			expect(event.stepValuesMap?.username).toBe("testuser");
		});
	});

	describe("what a step that did not fail says about errors", () => {
		const step = { source: { path: "/test/feature.ts", lineNumber: 1 }, in: "set count to 1", seqPath: [1, 1, 1] } as unknown as TFeatureStep;

		it("says nothing, so nothing downstream shows an error where there was none", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			logger.stepEnd(step, "VariablesStepper", "set", true, undefined, {}, undefined, undefined);

			const event = emitted[0] as { status?: string; error?: unknown };
			expect(event.status).toBe("completed");
			expect(event.error, "describing an absent error produces the word `undefined`, which reads as an error").toBeUndefined();
		});

		it("says what went wrong when something did", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));

			logger.stepEnd(step, "VariablesStepper", "set", false, new Error("no such variable"), {}, undefined, undefined);

			const event = emitted[0] as { status?: string; error?: unknown };
			expect(event.status).toBe("failed");
			expect(event.error).toBe("no such variable");
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

		it("should count a repeated subscription once removed, keeping per-kind counts exact", () => {
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

		it("delivers narration to a bare subscriber, and never a blip", () => {
			const emitted: unknown[] = [];
			logger.subscribe((event) => emitted.push(event));
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // so the blip emit is not short-circuited
			logger.emit(blip());
			logger.info("narration");
			expect(emitted.map((e) => (e as { kind: string }).kind)).toEqual(["log"]);
		});

		it("delivers exactly the named kinds to a kinds subscriber, the only way to receive blips", () => {
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
			logger.emit(blip("haibun.httpx.request")); // a sibling name is not in the haibun.http namespace
			logger.emit(blip("haibun.shu.view.scroll_adjust_other"));
			expect(emitted.map((e) => (e as { name: string }).name)).toEqual(["haibun.http.request", "haibun.shu.view.scroll_adjust"]);
		});

		it("answers hasSubscribers per name, so an unwatched blip is skipped at the recording site", () => {
			logger.subscribe(() => undefined, { kinds: ["blip"], names: ["haibun.http"] });
			expect(logger.hasSubscribers("blip", "haibun.http.request")).toBe(true);
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(false);
			logger.subscribe(() => undefined, { kinds: ["blip"] }); // an unfiltered blip subscriber wants every name
			expect(logger.hasSubscribers("blip", "haibun.shu.view.scroll_adjust")).toBe(true);
		});

		it("counts subscribers per kind, so a hot path can skip recording with one check", () => {
			expect(logger.hasSubscribers("blip")).toBe(false);
			logger.subscribe(() => undefined); // a bare subscriber is not a blip audience
			expect(logger.hasSubscribers("blip")).toBe(false);
			expect(logger.hasSubscribers("log")).toBe(true);
			const cb = () => undefined;
			logger.subscribe(cb, { kinds: ["blip"] });
			expect(logger.hasSubscribers("blip")).toBe(true);
			logger.unsubscribe(cb);
			expect(logger.hasSubscribers("blip")).toBe(false);
		});

		it("never narrates a blip to the console", () => {
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
});
