/** The table of the actuality feature the page reads: each event from each state. */
import { describe, expect, it } from "vitest";
import { ACTUALITY_FEATURES_EVENT, INITIAL_ACTUALITY_FEATURES, actualityFeaturesTransition, readingOf } from "./actuality-features.js";

const choose = (actualityFeature: string | undefined) => ({ type: ACTUALITY_FEATURES_EVENT.CHOOSE, actuality: actualityFeature }) as const;
const observe = (actualityFeature: string) => ({ type: ACTUALITY_FEATURES_EVENT.OBSERVE, actuality: actualityFeature }) as const;

describe("the actuality feature the page reads", () => {
	it("reads the observed actuality feature until a reader chooses one, and the observed again when the choice is cleared", () => {
		const observed = actualityFeaturesTransition(INITIAL_ACTUALITY_FEATURES, observe("e1"));
		expect(readingOf(observed)).toBe("e1");
		const chosen = actualityFeaturesTransition(observed, choose("e0"));
		expect(readingOf(chosen)).toBe("e0");
		expect(readingOf(actualityFeaturesTransition(chosen, choose(undefined)))).toBe("e1");
	});

	it("switches at each change of choice, and leaves a repeated choice as it is", () => {
		const chosen = actualityFeaturesTransition(INITIAL_ACTUALITY_FEATURES, choose("e0"));
		expect(chosen.switches).toBe(1);
		expect(actualityFeaturesTransition(chosen, choose("e0"))).toBe(chosen);
		expect(actualityFeaturesTransition(chosen, choose(undefined)).switches).toBe(2);
	});

	it("doesn't switch where the page reads its first actuality feature, and switches where another actuality feature follows", () => {
		const first = actualityFeaturesTransition(INITIAL_ACTUALITY_FEATURES, observe("e1"));
		expect(first.switches).toBe(0);
		expect(actualityFeaturesTransition(first, observe("e1"))).toBe(first);
		expect(actualityFeaturesTransition(first, observe("e2")).switches).toBe(1);
	});

	it("doesn't switch where another actuality feature is observed while a reader's choice stands", () => {
		const chosen = actualityFeaturesTransition(actualityFeaturesTransition(INITIAL_ACTUALITY_FEATURES, observe("e1")), choose("e0"));
		expect(actualityFeaturesTransition(chosen, observe("e2")).switches).toBe(chosen.switches);
	});
});
