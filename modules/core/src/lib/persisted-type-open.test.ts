import { describe, it, expect } from "vitest";
import { getDefaultWorld } from "./test/lib.js";
import { DOMAIN_PERSISTED_TYPE } from "./resources.js";

// The graph and column views read any type without an enumeration: the store holds what exists, so a type declared in
// an earlier session, or one otherwise unknown, is a {label: persisted-type} argument; only the empty string is refused.
describe("persisted-type domain is open (without an enumeration)", () => {
	it("accepts any non-empty type name", () => {
		const { schema } = getDefaultWorld().domains[DOMAIN_PERSISTED_TYPE];
		expect(schema.safeParse("Task").success).toBe(true);
		expect(schema.safeParse("SomeTypeFromAnEarlierSession").success).toBe(true);
		expect(schema.safeParse("").success).toBe(false);
	});
});
