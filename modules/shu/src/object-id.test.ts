import { describe, it, expect } from "vitest";
import { objectId } from "./object-id.js";
import { paneIdOf } from "./pane-state.js";

describe("objectId — one cross-system object handle", () => {
	it("composes (type, id) into a single addressable handle", () => {
		expect(objectId("Email", "msg-alpha@test.com")).toBe("Email:msg-alpha@test.com");
	});

	it("the entity column pane id is that handle, prefixed by pane kind — derived through objectId (one source)", () => {
		const d = { paneType: "entity", persistedAs: "Email", id: "msg-alpha@test.com" } as unknown as Parameters<typeof paneIdOf>[0];
		expect(paneIdOf(d)).toBe(`e:${objectId("Email", "msg-alpha@test.com")}`);
	});
});
