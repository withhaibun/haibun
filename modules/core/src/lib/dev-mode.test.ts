import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { failFastOrLog, isDev, resetDevModeCache, setDevMode } from "./dev-mode.js";

describe("dev-mode", () => {
	beforeEach(() => {
		resetDevModeCache();
	});

	afterEach(() => {
		resetDevModeCache();
	});

	it("setDevMode pins the result returned by isDev", () => {
		setDevMode(true);
		expect(isDev()).toBe(true);
		setDevMode(false);
		expect(isDev()).toBe(false);
	});

	it("failFastOrLog re-throws in dev so the original error reaches the developer", () => {
		setDevMode(true);
		const err = new Error("listener failed");
		expect(() => failFastOrLog("test", err)).toThrow(err);
	});

	it("failFastOrLog logs and returns in prod so siblings continue running", () => {
		setDevMode(false);
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const err = new Error("listener failed");
		expect(() => failFastOrLog("ctx", err)).not.toThrow();
		expect(spy).toHaveBeenCalledWith("ctx", err);
		spy.mockRestore();
	});
});
