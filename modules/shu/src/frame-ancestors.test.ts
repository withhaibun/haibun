import { describe, expect, it } from "vitest";
import { frameAncestors, framingSources, mayFrame } from "./frame-ancestors.js";

const EMBEDDER = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("frame-ancestors", () => {
	it("reads the sources of the directive among others, and doesn't restrict where a policy doesn't state it", () => {
		expect(framingSources(`default-src 'self'; ${frameAncestors(EMBEDDER)}`)).toEqual(["'self'", EMBEDDER]);
		expect(framingSources("default-src 'self'")).toBeUndefined();
		expect(framingSources(null)).toBeUndefined();
	});

	it("lets a page frame shu only where the policy names its origin or any origin", () => {
		expect(mayFrame(frameAncestors(undefined), EMBEDDER)).toBe(false);
		expect(mayFrame(frameAncestors(EMBEDDER), EMBEDDER)).toBe(true);
		expect(mayFrame("frame-ancestors *", EMBEDDER)).toBe(true);
		expect(mayFrame(null, EMBEDDER)).toBe(true);
	});
});
