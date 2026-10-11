import { describe, it, expect } from "vitest";
import { objectId, persistedTypeOf } from "./record-fields.js";
import { paneIdOf } from "./pane-kinds.js";

describe("objectId: one cross-system object handle", () => {
	it("composes (type, id) into a single addressable handle", () => {
		expect(objectId("Email", "msg-alpha@test.com")).toBe("Email:msg-alpha@test.com");
	});

	it("the entity column pane id is that handle, prefixed by pane kind, derived through objectId (one source)", () => {
		const d = { paneType: "entity", persistedAs: "Email", id: "msg-alpha@test.com" } as unknown as Parameters<typeof paneIdOf>[0];
		expect(paneIdOf(d)).toBe(`e:${objectId("Email", "msg-alpha@test.com")}`);
	});
});

describe("a record's persisted type", () => {
	it("reads the record's @type, and doesn't state a type for a row without one, as an ad-hoc result's rows", () => {
		expect(persistedTypeOf({ "@type": "Email" })).toBe("Email");
		expect(persistedTypeOf({ "@id": "r/1" })).toBeUndefined();
		expect(persistedTypeOf({ "@type": "" })).toBeUndefined();
	});
});
