import { describe, expect, it } from "vitest";
import { ActionsBarSchema } from "./schemas.js";

describe("ActionsBarSchema mode", () => {
	it("states the mode, which the bar's constructor states as search (CA4D7)", () => {
		expect(() => ActionsBarSchema.parse({})).toThrow();
	});

	it("accepts the three modes: search, step, ask", () => {
		for (const mode of ["search", "step", "ask"] as const) expect(ActionsBarSchema.parse({ mode }).mode).toBe(mode);
	});

	it("rejects an unknown mode", () => {
		expect(() => ActionsBarSchema.parse({ mode: "browse" })).toThrow();
	});
});
