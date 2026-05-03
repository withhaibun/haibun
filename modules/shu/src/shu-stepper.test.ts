import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { AccessLevelSchema, LinkRelations, commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { IQuadStore } from "@haibun/core/lib/quad-types.js";
import { z } from "zod";
import ShuStepper from "./shu-stepper.js";

function mockQuadStore(overrides: Partial<IQuadStore> = {}): IQuadStore {
	return {
		set: vi.fn(async () => undefined),
		get: vi.fn(async () => undefined),
		add: vi.fn(async () => undefined),
		query: vi.fn(async () => []),
		clear: vi.fn(async () => undefined),
		remove: vi.fn(async () => undefined),
		all: vi.fn(async () => []),
		upsertVertex: vi.fn(async () => ""),
		getVertex: vi.fn(async () => undefined),
		deleteVertex: vi.fn(async () => undefined),
		queryVertices: vi.fn(async () => []),
		distinctPropertyValues: vi.fn(async () => []),
		...overrides,
	};
}

function selectProducts(result: Awaited<ReturnType<ShuStepper["steps"]["getSelectValues"]["action"]>>): { values: Record<string, string[]> } {
	return result.products as { values: Record<string, string[]> };
}

describe("ShuStepper", () => {
	let stepper: ShuStepper;
	let addRoute: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		stepper = new ShuStepper();
		const mounted = new Set<string>();
		addRoute = vi.fn((_type: string, path: string) => {
			if (mounted.has(path)) throw new Error(`already mounted at "${path}"`);
			mounted.add(path);
		});
		const world = getDefaultWorld();
		world.runtime[WEBSERVER] = { addRoute, mounted: { get: {} } };
		await stepper.setWorld(world, []);
	});

	it("rejects invalid mount paths", async () => {
		const result = await stepper.steps.serveShuApp.action({ path: "spa" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected invalid mount path to fail");
		expect(result.errorMessage).toContain('path must start with "/"');
		expect(addRoute).not.toHaveBeenCalled();
	});

	it("throws on duplicate mount at same path", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(first.ok).toBe(true);
		expect(() => stepper.steps.serveShuApp.action({ path: "/spa" })).toThrow("already mounted");
	});

	it("returns no select values for Comment (no enum-backed fields)", async () => {
		const world = stepper.getWorld();
		const commentDomain = mapDefinitionsToDomains([commentDomainDefinition])[commentDomainDefinition.selectors.sort().join(" | ")];
		world.domains = { ...world.domains, comment: commentDomain };
		world.shared.getStore = vi.fn(() => mockQuadStore());

		const result = await stepper.steps.getSelectValues.action({ label: "Comment" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({});
	});

	it("fails when no filter topology is registered for the label", async () => {
		const result = await stepper.steps.getSelectValues.action({ label: "Missing" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected missing filter topology to fail");
		expect(result.errorMessage).toContain("No filter topology registered for Missing");
	});

	it("keeps context-rel select discovery in shu", async () => {
		const world = stepper.getWorld();
		world.domains = {
			...world.domains,
			email: {
				selectors: ["test-email"],
				schema: z.object({ id: z.string(), account: z.string(), folder: z.string(), accessLevel: AccessLevelSchema, dateSent: z.date() }),
				coerce: (proto: { value?: unknown }) => proto.value,
				topology: {
					vertexLabel: "Email",
					id: "id",
					properties: {
						id: LinkRelations.IDENTIFIER.rel,
						account: LinkRelations.CONTEXT.rel,
						folder: LinkRelations.CONTEXT.rel,
						accessLevel: LinkRelations.TAG.rel,
					},
				},
			},
		};
		const distinctPropertyValues = vi.fn(async (_label: string, property: string) => (property === "account" ? ["primary"] : ["INBOX", "Sent"]));
		world.shared.getStore = vi.fn(() => mockQuadStore({ distinctPropertyValues }));

		const result = await stepper.steps.getSelectValues.action({ label: "Email" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({ account: ["primary"], folder: ["INBOX", "Sent"] });
		expect(distinctPropertyValues).toHaveBeenCalledTimes(2);
	});
});
