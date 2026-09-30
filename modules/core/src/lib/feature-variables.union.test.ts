import { describe, it, expect, beforeEach } from "vitest";
import { FeatureVariables } from "./feature-variables.js";
import type { TWorld } from "./world.js";
import { Origin } from "../schema/protocol.js";
import { getDefaultWorld } from "./test/lib.js";
import { DOMAIN_STRING } from "./domains.js";

describe("FeatureVariables - Union Domains", () => {
	let world: TWorld;
	let variables: FeatureVariables;

	beforeEach(() => {
		world = getDefaultWorld();
		variables = new FeatureVariables(world);
	});

	it('should resolve literal string when domain is "string | other"', async () => {
		// "string" is a built-in domain in default world
		const result = await variables.resolveVariable({
			term: "literalValue",
			origin: Origin.quoted,
			domain: `string | other`,
		});

		expect(result.value).toBe("literalValue");
		expect(result.domain).toBe(DOMAIN_STRING);
	});

	it("should coerce using resolved domain", async () => {
		const result = await variables.resolveVariable({
			term: "/some/path",
			origin: Origin.quoted,
			domain: `invalid | mockDomain`,
		});

		// A union that isn't a registered domain is coerced as a string.
		expect(result.value).toBe("/some/path");
		expect(result.domain).toBe(DOMAIN_STRING);
	});
});
