import { describe, it, expect } from "vitest";
import { DISCOURSE, DiscourseSchema } from "./discourse.js";

describe("Discourse", () => {
	it("accepts every value in the closed enum", () => {
		for (const v of Object.values(DISCOURSE)) {
			expect(() => DiscourseSchema.parse(v)).not.toThrow();
		}
	});

	it("rejects values outside the enum", () => {
		expect(() => DiscourseSchema.parse("unknown")).toThrow();
		expect(() => DiscourseSchema.parse("")).toThrow();
		expect(() => DiscourseSchema.parse(null)).toThrow();
	});

	it("includes the speech acts the autonomic loop emits", () => {
		// suggest → LLM writes a proposal
		// measure → narration of a Measurement
		// apply / revert → narration of a Development
		expect(DISCOURSE.suggest).toBe("suggest");
		expect(DISCOURSE.measure).toBe("measure");
		expect(DISCOURSE.apply).toBe("apply");
		expect(DISCOURSE.revert).toBe("revert");
	});

	it("includes human-response acts", () => {
		expect(DISCOURSE.question).toBe("question");
		expect(DISCOURSE.narrate).toBe("narrate");
		expect(DISCOURSE.report).toBe("report");
	});

	it("includes play (rehearsal / try-out with no side effects)", () => {
		expect(DISCOURSE.play).toBe("play");
	});

	it("DISCOURSE keys match their values (the const is a canonical shape)", () => {
		for (const [key, value] of Object.entries(DISCOURSE)) {
			expect(key).toBe(value);
		}
	});
});
