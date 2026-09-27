import { describe, it, expect, afterEach, vi } from "vitest";
import { failFastOrLog, isDev } from "./dev-mode.js";

const PRODUCTION = "production";

describe("dev-mode", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is dev unless NODE_ENV names production", () => {
		vi.stubEnv("NODE_ENV", "development");
		expect(isDev()).toBe(true);
		vi.stubEnv("NODE_ENV", PRODUCTION);
		expect(isDev()).toBe(false);
	});

	it("failFastOrLog re-throws in dev so the original error reaches the developer", () => {
		vi.stubEnv("NODE_ENV", "development");
		const err = new Error("listener failed");
		expect(() => failFastOrLog("test", err)).toThrow(err);
	});

	it("failFastOrLog logs and returns in prod so siblings continue running", () => {
		vi.stubEnv("NODE_ENV", PRODUCTION);
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const err = new Error("listener failed");
		expect(() => failFastOrLog("ctx", err)).not.toThrow();
		expect(spy).toHaveBeenCalledWith("ctx", err);
		spy.mockRestore();
	});
});
