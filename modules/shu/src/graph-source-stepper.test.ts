// The graph a page reads, over the store this instance holds: the values a filter offers for a type, and one
// individual with the edges its quads name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { Access, AccessLevelSchema, LinkRelations, commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { distinctOf } from "@haibun/core/lib/records/derivations/read-records.js";
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
		deleteIndividual: vi.fn(async () => undefined),
		readRecords: vi.fn(async () => ({ vertices: [], total: 0, saturated: false, order: [] })),
		distinctPropertyValues: vi.fn(async () => distinctOf([])),
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

	it("offers the conversation of a Comment as its one filter value", async () => {
		const world = stepper.getWorld();
		world.domains = { ...world.domains, ...mapDefinitionsToDomains([commentDomainDefinition]) };
		world.shared.getStore = vi.fn(() => mockQuadStore());

		const result = await stepper.steps.getSelectValues.action({ label: "Comment" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({ [LinkRelations.CONTEXT.rel]: [] });
	});

	it("fails when a filter topology isn't registered for the label", async () => {
		const result = await stepper.steps.getSelectValues.action({ label: "Missing" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected missing filter topology to fail");
		expect(result.errorMessage).toContain("a filter topology isn't registered for Missing");
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
					accessLevel: Access.private,
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel, account: LinkRelations.CONTEXT.rel, folder: LinkRelations.CONTEXT.rel, accessLevel: LinkRelations.ACCESS_LEVEL.rel },
				},
			},
		};
		const distinctPropertyValues = vi.fn(async (_label: string, property: string) => distinctOf(property === "account" ? ["primary"] : ["INBOX", "Sent"]));
		world.shared.getStore = vi.fn(() => mockQuadStore({ distinctPropertyValues }));

		const result = await stepper.steps.getSelectValues.action({ label: "Email" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({ account: ["primary"], folder: ["INBOX", "Sent"] });
		expect(distinctPropertyValues).toHaveBeenCalledTimes(2);
	});
});

describe("one individual with its edges, from the store this instance holds", () => {
	const [EMAIL, MESSAGE] = ["Email", "Message"];
	const ABOUT = LinkRelations.TARGET.rel;
	const declared = (persistedAs: string, edges = {}) => ({
		selectors: [`test-${persistedAs.toLowerCase()}`],
		schema: z.looseObject({ id: z.string() }),
		description: `A ${persistedAs} a test reads`,
		topology: { persistedAs, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel }, edges },
	});
	const held = async (): Promise<GraphSourceStepper> => {
		const stepper = new GraphSourceStepper();
		const world = getDefaultWorld();
		world.domains = { ...world.domains, ...mapDefinitionsToDomains([declared(EMAIL), declared(MESSAGE, { about: { rel: ABOUT, range: EMAIL } })]) };
		await stepper.setWorld(world, []);
		const store = world.shared.getStore();
		await store.set("a@test.com", "address", "a@test.com", EMAIL);
		await store.add({ subject: "m1", predicate: ABOUT, object: "a@test.com", namedGraph: MESSAGE, objectType: EMAIL });
		return stepper;
	};

	it("returns the record, its outgoing edges, and the count of records that reference it", async () => {
		const stepper = await held();
		const result = await stepper.steps.getIndividualWithEdges.action({ label: EMAIL, id: "a@test.com" });
		expect(result.ok).toBe(true);
		const read = result.products as { vertex: Record<string, unknown>; edges: Array<{ type: string; direction: string }>; incomingCount: number };
		expect(read.vertex).toMatchObject({ "@id": "a@test.com", "@type": EMAIL, address: "a@test.com" });
		expect(read.edges, "the record doesn't hold an edge of its own").toEqual([]);
		expect(read.incomingCount).toEqual({ total: 1, saturated: false });
	});

	it("fails where the store doesn't hold the record", async () => {
		const stepper = await held();
		const result = await stepper.steps.getIndividualWithEdges.action({ label: EMAIL, id: "nobody@test.com" });
		expect(result.ok).toBe(false);
	});
});

describe("the clustered sample a graph view reads", () => {
	it("refuses a count of each type's records above MAX_PAGE_ROWS, and doesn't read the store", async () => {
		const stepper = new GraphSourceStepper();
		const world = getDefaultWorld();
		await stepper.setWorld(world, []);
		const getClusteredQuads = vi.fn(async () => ({ quads: [], clusters: [] }));
		world.shared.getStore = vi.fn(() => mockQuadStore({ getClusteredQuads }));
		const over = MAX_PAGE_ROWS + 1;
		const refused = await stepper.steps.getClusteredQuads.action({ perTypeLimit: over, accessLevel: Access.private });
		expect(refused).toMatchObject({ ok: false });
		expect(refused.ok ? "" : refused.errorMessage).toContain(`getClusteredQuads rejects a limit of ${over} rows: a page holds 1 to ${MAX_PAGE_ROWS} rows`);
		expect(getClusteredQuads).not.toHaveBeenCalled();
	});
});
