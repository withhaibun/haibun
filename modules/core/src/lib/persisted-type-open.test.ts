import { describe, it, expect } from "vitest";
import { refreshHypermediaTypeDomain } from "./domains.js";
import { DOMAIN_PERSISTED_TYPE } from "./resources.js";

// The generalized graph/column views explore any type without a compiled enum: persisted-type validation is open (the
// store is the source of truth), so a type declared in an earlier session — or any otherwise-unknown type — still
// validates as a {label: persisted-type} argument; only the empty string is rejected.
describe("persisted-type domain is open (no enumeration)", () => {
	it("accepts any non-empty type name", () => {
		const world = { domains: {} } as unknown as Parameters<typeof refreshHypermediaTypeDomain>[0];
		refreshHypermediaTypeDomain(world);
		const entry = Object.values(world.domains).find((d) => (d as { selectors?: string[] }).selectors?.includes(DOMAIN_PERSISTED_TYPE)) as { schema: { safeParse(v: unknown): { success: boolean } } };
		expect(entry.schema.safeParse("Task").success).toBe(true);
		expect(entry.schema.safeParse("SomeTypeFromAnEarlierSession").success).toBe(true);
		expect(entry.schema.safeParse("").success).toBe(false);
	});
});
