import { describe, expect, it } from "vitest";
import { ActionsBarSchema } from "./schemas.js";

describe("ActionsBarSchema mode", () => {
	it("defaults to search — browsing/filtering is the primary activity, so a fresh bar opens in Search mode", () => {
		expect(ActionsBarSchema.parse({}).mode).toBe("search");
	});

	it("accepts the three modes: search, step, ask", () => {
		for (const mode of ["search", "step", "ask"] as const) expect(ActionsBarSchema.parse({ mode }).mode).toBe(mode);
	});

	it("rejects an unknown mode", () => {
		expect(() => ActionsBarSchema.parse({ mode: "browse" })).toThrow();
	});
});
