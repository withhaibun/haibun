import { describe, it, expect, beforeEach } from "vitest";
import { EventLogger } from "./EventLogger.js";
import { TFeatureStep } from "./astepper.js";
import { OBSCURED_VALUE } from "./feature-variables.js";

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
});
