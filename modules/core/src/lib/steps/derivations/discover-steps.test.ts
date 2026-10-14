/**
 * Discovery reads the concern catalog built once for each set of registered domains, and builds it again once a domain is
 * registered (PF35, CP7R3).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld } from "../../test/lib.js";
import { registerDomains } from "../../domains.js";
import { Access, LinkRelations } from "../../resources.js";
import { concernCatalogOf } from "./discover-steps.js";

describe("the concern catalog discovery reads", () => {
	it("is built once while the registered domains don't change, and again once a domain is registered", () => {
		const world = getDefaultWorld();
		const catalog = concernCatalogOf(world.domains);
		expect(concernCatalogOf(world.domains), "the held catalog").toBe(catalog);
		registerDomains(world, [
			[
				{
					selectors: ["Gadget"],
					schema: z.object({ id: z.string(), name: z.string(), generatedAtTime: z.string() }),
					description: "A gadget a test declares",
					topology: {
						persistedAs: "Gadget",
						id: "id",
						accessLevel: Access.private,
						properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
					},
				},
			],
		]);
		const rebuilt = concernCatalogOf(world.domains);
		expect(rebuilt).not.toBe(catalog);
		expect(Object.keys(rebuilt.persisted)).toContain("Gadget");
	});
});
