import { describe, it, expect, vi, beforeEach } from "vitest";
import TuiMonitorStepper from "./index.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { TWorld } from "@haibun/core/lib/execution.js";

// Mock ink render to avoid actual TUI output during tests
vi.mock("ink", () => {
	return {
		render: vi.fn(() => ({
			rerender: vi.fn(),
			unmount: vi.fn(),
			waitUntilExit: vi.fn(),
			cleanup: vi.fn(),
		})),
		Text: (): null => null,
		Box: (): null => null,
		Static: (): null => null,
		useInput: (): null => null,
	};
});

describe("TuiMonitorStepper", () => {
	let stepper: TuiMonitorStepper;
	let mockWorld: TWorld;

	beforeEach(() => {
		stepper = new TuiMonitorStepper();
		mockWorld = {
			prompter: {
				subscribe: vi.fn(),
			},
			eventLogger: {
				suppressConsole: false,
			},
		} as unknown as TWorld;
	});

	it("subscribes to world prompter on setWorld", async () => {
		await stepper.setWorld(mockWorld, []);
		expect(mockWorld.prompter.subscribe).toHaveBeenCalledWith(stepper);
	});

	it("handles prompt and resolve", async () => {
		const prompt = { id: "p1", message: "test prompt" };

		// Start the execution cycle to initialize the renderer (which sets up promptResolver logic indirectly via component update)
		// However, in our class implementation, prompt() sets promptResolver directly.

		const promptPromise = stepper.prompt(prompt);

		// Resolve it
		stepper.resolve("p1", "choice");

		const result = await promptPromise;
		expect(result).toBe("choice");
	});

	it("handles cancel", async () => {
		const prompt = { id: "p2", message: "to cancel" };
		const promptPromise = stepper.prompt(prompt);

		stepper.cancel("p2");

		await expect(promptPromise).rejects.toThrow("Cancelled");
	});
});
