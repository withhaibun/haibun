import { describe, expect, it } from "vitest";
import { loadedOnFirstUse } from "./page-held.js";

describe("a module loaded at its first use", () => {
	it("loads at the first call, and each call after it reads the same load", async () => {
		let loads = 0;
		const loaded = loadedOnFirstUse(() => {
			loads += 1;
			return Promise.resolve({ signer: "loaded" });
		});
		expect(loads).toBe(0);
		const [first, second] = await Promise.all([loaded(), loaded()]);
		expect(first).toBe(second);
		expect(loads).toBe(1);
	});
});
