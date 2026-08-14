import { describe, expect, it } from "vitest";
import { COMMENT_LABEL, PRINCIPAL_LABEL, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL } from "@haibun/core/lib/resources.js";
import { AVATAR_MAX_CHARS, typeAvatar } from "./polymorphic-type-avatar.js";

describe("typeAvatar", () => {
	it("takes the initial of each word in the type name", () => {
		expect(typeAvatar(PRINCIPAL_LABEL)).toBe("P");
		expect(typeAvatar(SPECIFIC_RESOURCE_LABEL)).toBe("SR");
		expect(typeAvatar(TEXT_QUOTE_SELECTOR_LABEL)).toBe("TQS");
		expect(typeAvatar(COMMENT_LABEL)).toBe("C");
	});

	it("reads a separator-delimited or lowercase type, so an instrumentation graph avatars too", () => {
		expect(typeAvatar("observation/http-request")).toBe("OHR");
		expect(typeAvatar("facts")).toBe("F");
	});

	it("keeps a leading acronym as one word", () => {
		expect(typeAvatar("URLThing")).toBe("UT");
	});

	it("bounds a long type name to a glanceable badge", () => {
		expect(typeAvatar("One Two Three Four Five")).toBe("OTT");
		expect(typeAvatar("AVeryLongTypeNameIndeed").length).toBe(AVATAR_MAX_CHARS);
	});

	it("has no avatar for a type name with no words", () => {
		expect(typeAvatar("")).toBe("");
		expect(typeAvatar("///")).toBe("");
	});
});
