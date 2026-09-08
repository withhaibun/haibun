// The graph a page reads, over the store this instance holds: the values a filter offers for a type, and one
// individual with the edges its quads name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { AccessLevelSchema, LinkRelations, commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { IQuadStore } from "@haibun/core/lib/quad-types.js";
import { z } from "zod";
import GraphSourceStepper from "./graph-source-stepper.js";

function mockQuadStore(overrides: Partial<IQuadStore> = {}): IQuadStore {
	return {
		set: vi.fn(async () => undefined),
		get: vi.fn(async () => undefined),
		add: vi.fn(async () => undefined),
		query: vi.fn(async () => []),
		clear: vi.fn(async () => undefined),
		remove: vi.fn(async () => undefined),
		all: vi.fn(async () => []),
		upsertIndividual: vi.fn(async () => ""),
		getIndividual: vi.fn(async () => undefined),
		deleteIndividual: vi.fn(async () => undefined),
		queryIndividuals: vi.fn(async () => []),
		distinctPropertyValues: vi.fn(async () => []),
		density: vi.fn(async () => ({ buckets: [] })),
		getClusteredQuads: vi.fn(async () => ({ quads: [], clusters: [] })),
		...overrides,
	};
}

function selectProducts(result: Awaited<ReturnType<GraphSourceStepper["steps"]["getSelectValues"]["action"]>>): { values: Record<string, string[]> } {
	return result.products as { values: Record<string, string[]> };
}

describe("the values a filter offers", () => {
	let stepper: GraphSourceStepper;

	beforeEach(async () => {
		stepper = new GraphSourceStepper();
		await stepper.setWorld(getDefaultWorld(), []);
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
				description: "An email message.",
				topology: {
					persistedAs: "Email",
					id: "id",
					properties: {
						id: LinkRelations.IDENTIFIER.rel,
						account: LinkRelations.CONTEXT.rel,
						folder: LinkRelations.CONTEXT.rel,
						accessLevel: LinkRelations.ACCESS_LEVEL.rel,
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

describe("one individual with its edges, from the store this instance holds", () => {
	const EMAIL = "Email";
	const held = async (): Promise<GraphSourceStepper> => {
		const stepper = new GraphSourceStepper();
		const world = getDefaultWorld();
		await stepper.setWorld(world, []);
		const store = world.shared.getStore();
		await store.set("a@test.com", "address", "a@test.com", EMAIL);
		await store.add({ subject: "m1", predicate: "about", object: "a@test.com", namedGraph: "Message", objectType: EMAIL });
		return stepper;
	};

	it("answers with the record, the edges pointing at it, and how many those are", async () => {
		const stepper = await held();
		const result = await stepper.steps.getIndividualWithEdges.action({ label: EMAIL, id: "a@test.com" });
		expect(result.ok).toBe(true);
		const answer = result.products as { vertex: Record<string, unknown>; edges: Array<{ type: string; direction: string }>; incomingCount: number };
		expect(answer.vertex).toMatchObject({ "@id": "a@test.com", "@type": EMAIL, address: "a@test.com" });
		expect(answer.edges.filter((edge) => edge.direction === "in").map((edge) => edge.type)).toEqual(["about"]);
		expect(answer.incomingCount).toBe(1);
	});

	it("says so where it holds nothing of the individual, rather than answering with an empty one", async () => {
		const stepper = await held();
		const result = await stepper.steps.getIndividualWithEdges.action({ label: EMAIL, id: "nobody@test.com" });
		expect(result.ok).toBe(false);
	});
});
