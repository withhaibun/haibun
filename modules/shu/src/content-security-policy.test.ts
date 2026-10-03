import { describe, expect, it } from "vitest";
import { frameAncestors, framingSources, mayFrame } from "./content-security-policy.js";

const EMBEDDER = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("frame-ancestors", () => {
	it("reads the sources of the directive among others, of each policy a header carries, and doesn't restrict where a policy doesn't state it", () => {
		expect(framingSources(`default-src 'self'; ${frameAncestors(EMBEDDER)}`)).toEqual([["'self'", EMBEDDER]]);
		expect(framingSources(`${frameAncestors(EMBEDDER)}, frame-ancestors 'none'`)).toEqual([["'self'", EMBEDDER], ["'none'"]]);
		expect(framingSources("default-src 'self'")).toEqual([]);
		expect(framingSources(null)).toEqual([]);
	});

	it("lets a page frame shu only where the policy names its origin or any origin", () => {
		expect(mayFrame(frameAncestors(undefined), EMBEDDER)).toBe(false);
		expect(mayFrame(frameAncestors(EMBEDDER), EMBEDDER)).toBe(true);
		expect(mayFrame("frame-ancestors *", EMBEDDER)).toBe(true);
		expect(mayFrame(null, EMBEDDER)).toBe(true);
		expect(mayFrame(`${frameAncestors(EMBEDDER)}, frame-ancestors 'none'`, EMBEDDER), "every policy a header carries must allow it").toBe(false);
	});
});
