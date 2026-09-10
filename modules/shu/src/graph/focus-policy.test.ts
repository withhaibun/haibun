import { describe, it, expect } from "vitest";
import { focusStateFor, opacityFor, isFullContrast, type FocusState, type KindTiers } from "./focus-policy.js";

describe("focusStateFor: the one focus/dim decision", () => {
	// Exhaustive truth table over the 4 booleans. previewActive wins; then focus; then resting.
	const cases: Array<[boolean, boolean, boolean, boolean, FocusState]> = [
		// previewActive=false
		[false, false, false, false, "resting"], // nothing active
		[false, true, false, false, "resting"], // isInFocus alone is meaningless without focus
		[true, false, false, false, "dimmed"], // focus active, not in focus → dimmed
		[true, true, false, false, "full"], // focus active, in focus → full
		// previewActive=true overrides focus entirely
		[false, false, true, false, "dimmed"], // preview, no match → dimmed
		[false, false, true, true, "full"], // preview, match → full
		[true, true, true, false, "dimmed"], // preview beats an otherwise-full focus when type doesn't match
		[true, false, true, true, "full"], // preview match wins even when focus would dim
	];
	it.each(cases)("focusActive=%s isInFocus=%s previewActive=%s matchesPreview=%s → %s", (focusActive, isInFocus, previewActive, matchesPreview, expected) => {
		expect(focusStateFor({ focusActive, isInFocus, previewActive, matchesPreview })).toBe(expected);
	});

	it("preview precedence holds across every focus combination (preview is checked first)", () => {
		for (const focusActive of [false, true])
			for (const isInFocus of [false, true]) {
				expect(focusStateFor({ focusActive, isInFocus, previewActive: true, matchesPreview: true })).toBe("full");
				expect(focusStateFor({ focusActive, isInFocus, previewActive: true, matchesPreview: false })).toBe("dimmed");
			}
	});
});

describe("opacityFor / isFullContrast, per-kind mapping", () => {
	const LINE: KindTiers = { full: 1, dimmed: 0.04, resting: 0.55 };
	const NODE: KindTiers = { full: 1, dimmed: 0.04, resting: 1 };

	it("maps each tier to the kind's constant", () => {
		expect(opacityFor("full", LINE)).toBe(1);
		expect(opacityFor("dimmed", LINE)).toBe(0.04);
		expect(opacityFor("resting", LINE)).toBe(0.55); // lines are the only kind whose resting != full
		expect(opacityFor("resting", NODE)).toBe(1);
	});

	it("isFullContrast is true only for the full tier (the colour axis)", () => {
		expect(isFullContrast("full")).toBe(true);
		expect(isFullContrast("dimmed")).toBe(false);
		expect(isFullContrast("resting")).toBe(false);
	});
});
