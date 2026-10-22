import { describe, it, expect, vi, beforeEach } from "vitest";
import TuiMonitorStepper from "./monitor-tui-stepper.js";
import { TWorld } from "@haibun/core/lib/world.js";

// vi.mock replaces ink, so the tests don't write TUI output.
vi.mock("ink", () => {
	return {
		render: vi.fn(() => ({ rerender: vi.fn(), unmount: vi.fn(), waitUntilExit: vi.fn(), cleanup: vi.fn() })),
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
		mockWorld = { prompter: { subscribe: vi.fn() }, eventLogger: { suppressConsole: false } } as unknown as TWorld;
	});

	it("subscribes to world prompter on setWorld", async () => {
		await stepper.setWorld(mockWorld, []);
		expect(mockWorld.prompter.subscribe).toHaveBeenCalledWith(stepper);
	});

	it("handles prompt and resolve", async () => {
		const prompt = { id: "p1", message: "test prompt" };

		// prompt() sets promptResolver. resolve() doesn't depend on the ink render that startActuality creates.

		const promptPromise = stepper.prompt(prompt);

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
