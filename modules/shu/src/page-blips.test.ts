/**
 * A long frame is attributed to the script that held it longest, named by function and file, or to the browser's own
 * rendering where a script didn't run in it.
 */
import { describe, it, expect } from "vitest";
import { RENDERING_ONLY, scriptOf } from "./page-blips.js";

const script = (duration: number, sourceFunctionName: string, invoker = "FrameRequestCallback", sourceURL = "http://localhost/assets/shu-bundle.js") => ({
	duration,
	sourceFunctionName,
	invoker,
	sourceURL,
});

describe("a long frame's script", () => {
	it("is its longest, named by function and file", () => {
		expect(scriptOf({ scripts: [script(12, "tick"), script(40, "render"), script(8, "billboardLabels")] })).toBe("render shu-bundle.js");
	});

	it("is named by what invoked it where the browser doesn't name a function", () => {
		expect(scriptOf({ scripts: [script(30, "", "ResizeObserverCallback")] })).toBe("ResizeObserverCallback shu-bundle.js");
	});

	it("is the browser's rendering where a script didn't run", () => {
		expect(scriptOf({ scripts: [] })).toBe(RENDERING_ONLY);
	});
});
