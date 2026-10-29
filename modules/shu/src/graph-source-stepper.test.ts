// The graph a page reads, over the store this instance holds: the values a filter offers for a type, one individual with the
// edges its quads name, and the axioms of what a graph view shows.
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld, getTestWorldWithOptions, testWithWorld } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import type { TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { Access, AccessLevelSchema, FACT_LABEL, LinkRelations, SEQ_PATH_LABEL, commentDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { RUN_AUTHORITY, runAuthorizedWith } from "@haibun/core/lib/domains/capability-context.js";
import { FACT_FIELD } from "@haibun/core/lib/records/domains/facts.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import type { TDensityQuery, TQuad } from "@haibun/core/lib/quad-types.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { distinctOf } from "@haibun/core/lib/records/derivations/read-records.js";
import { z } from "zod";
import { callStatedStepFrom } from "@haibun/core/lib/call-step.js";
import GraphSourceStepper from "./graph-source-stepper.js";
import type { TGraphView } from "./pipelines/graph-source.js";
import { GraphAxiomsSchema, type TGraphAxioms } from "@haibun/core/lib/records/domains/axioms.js";

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
		await store.upsertIndividual(EMAIL, { id: "a@test.com", address: "a@test.com" });
		await store.upsertIndividual(MESSAGE, { id: "m1" });
		await store.add({ subject: "m1", predicate: ABOUT, object: "a@test.com", namedGraph: MESSAGE, objectType: EMAIL });
		return stepper;
	};

	it("returns the record, its outgoing edges, and the count of records that reference it", async () => {
		const stepper = await held();
		const result = await stepper.steps.getIndividualWithEdges.action({ label: EMAIL, id: "a@test.com" });
		expect(result.ok).toBe(true);
		const read = result.products as { vertex: Record<string, unknown>; edges: Array<{ type: string; direction: string }>; incomingCount: number };
		expect(read.vertex).toMatchObject({ "@id": heldRecordIri(EMAIL, "a@test.com"), "@type": EMAIL, address: "a@test.com" });
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

describe("the axioms of what a graph view shows", () => {
	const [EMAIL, A, B, C] = ["Email", "a@test.com", "b@test.com", "c@test.com"];
	const quad = (subject: string, namedGraph: string, predicate: string, object: string, objectType?: string): TQuad => ({
		subject,
		namedGraph,
		predicate,
		object,
		timestamp: subject === A ? 1 : 2,
		...(objectType === undefined ? {} : { objectType }),
	});
	const QUADS = [
		quad(A, EMAIL, "subject", "Roadmap"),
		quad(B, EMAIL, "subject", "Re: Roadmap"),
		quad(B, EMAIL, "inReplyTo", A, EMAIL),
		quad(C, EMAIL, "_held", "beside its type, a record whose quads state neither a property nor an edge"),
		quad("fact-1", FACT_LABEL, FACT_FIELD.domain, "cart"),
		quad("step-1", SEQ_PATH_LABEL, SEQ_PATH_FIELD.stepText, "dinner is ready"),
	];
	const cluster = (type: string, subjects: string[]) => ({
		type,
		totalCount: subjects.length,
		sampledCount: subjects.length,
		omittedCount: 0,
		sampledSubjects: subjects,
		displayLabels: {},
	});
	const CLUSTERS = [cluster(EMAIL, [A, B, C]), cluster(FACT_LABEL, ["fact-1"]), cluster(SEQ_PATH_LABEL, ["step-1"])];
	/** The emails' type, which declares the property and the edge their quads state, so the registry holds their predicates. */
	const EMAIL_TYPE = {
		selectors: ["test-email"],
		schema: z.looseObject({ id: z.string(), generatedAtTime: z.string() }),
		description: "An email a test reads",
		topology: {
			persistedAs: EMAIL,
			id: "id",
			accessLevel: Access.private,
			properties: { id: LinkRelations.IDENTIFIER.rel, subject: LinkRelations.NAME.rel },
			edges: { inReplyTo: { rel: LinkRelations.IN_REPLY_TO.rel, range: EMAIL } },
		},
	};

	const axiomsFor = async (view: Pick<TGraphView, "overrides"> & Partial<TGraphView>, quads = QUADS): Promise<TGraphAxioms> => {
		const stepper = new GraphSourceStepper();
		const world = getDefaultWorld();
		world.domains = { ...world.domains, ...mapDefinitionsToDomains([EMAIL_TYPE]) };
		world.runtime.steppers = [stepper];
		await stepper.setWorld(world, world.runtime.steppers);
		world.shared.getStore = vi.fn(() => mockQuadStore({ getClusteredQuads: vi.fn(async () => ({ quads, clusters: CLUSTERS })) }));
		const result = await runAuthorizedWith(RUN_AUTHORITY, async () =>
			stepper.steps.showAxioms.action({ view: { perTypeLimit: 10, accessLevel: Access.private, hiddenPredicates: [], prune: false, ...view } }),
		);
		if (!result.ok) throw new Error(result.errorMessage);
		return GraphAxiomsSchema.parse(result.products);
	};
	const named = async (view: Pick<TGraphView, "overrides"> & Partial<TGraphView>): Promise<string[]> => (await axiomsFor(view)).frames.map(({ name }) => name);

	it("maps an edge of the shared vocabulary that a type doesn't declare to its relation, as a typed link states it", async () => {
		const { frames } = await axiomsFor({ overrides: {} }, [...QUADS, quad(A, EMAIL, LinkRelations.AUTHOR.rel, B, EMAIL)]);
		expect(frames.map(({ name }) => name)).toContain(`ObjectProperty ${LinkRelations.AUTHOR.rel}`);
	});

	it("describes each record as an individual of its type's class with its facts, each type as a class and each link relation of an edge as a property", async () => {
		const { frames, summary, text } = await axiomsFor({ overrides: { [FACT_LABEL]: true, [SEQ_PATH_LABEL]: true } });
		const frame = (name: string) => frames.find((one) => one.name === name);
		expect(frame(`Individual ${B}`)).toMatchObject({
			manchester: `Individual: <${B}>\n    Types: Email\n    Facts: subject "Re: Roadmap", inReplyTo <${A}>`,
			dl: `Email(<${B}>) · subject(<${B}>, "Re: Roadmap") · inReplyTo(<${B}>, <${A}>)`,
			statement: "Email b@test.com",
			assertedBy: { persistedAs: EMAIL, id: B },
			edges: [{ from: B, label: "inReplyTo", to: A }],
		});
		expect(frame(`Individual step-1`)?.statement, "a step's record states its line").toBe("dinner is ready");
		expect(frame(`ObjectProperty ${LinkRelations.IN_REPLY_TO.rel}`)?.dl).toContain(`∃${LinkRelations.IN_REPLY_TO.rel}.⊤ ⊑ `);
		expect(frame("Class Email")).toMatchObject({ manchester: "Class: Email", dl: "Email ⊑ ⊤", nodes: [A, B, C] });
		expect(summary).toEqual({ classes: 3, properties: 1, individuals: 5 });
		expect(text.split("\n\n")).toHaveLength(frames.length);
	});

	it("hides the types a view hides and the predicates a reader hid, prunes, and stops at the time cursor", async () => {
		expect(await named({ overrides: {}, hiddenPredicates: ["inReplyTo"], timeCursor: 1 })).toEqual(["Class Email", `Individual ${A}`]);
		expect(await named({ overrides: { [EMAIL]: true }, prune: true })).toEqual([
			"Class Email",
			`ObjectProperty ${LinkRelations.IN_REPLY_TO.rel}`,
			`Individual ${A}`,
			`Individual ${B}`,
		]);
	});
});

describe("the counts a shape reads, and the rows of a graph query a time bounds", () => {
	it("returns the counts the store reads for a shape, as a page reads them over its own copy", async () => {
		const stepper = new GraphSourceStepper();
		await stepper.setWorld(getDefaultWorld(), []);
		const buckets = [{ start: 0, end: 10, count: 2 }];
		stepper.getWorld().shared.getStore = vi.fn(() => mockQuadStore({ density: vi.fn(async () => ({ buckets })) }));
		const query: TDensityQuery = { label: SEQ_PATH_LABEL, timeField: SEQ_PATH_FIELD.generatedAtTime, from: "2026-01-01", to: "2026-02-01", buckets: 1, groupBy: "status" };
		expect(await stepper.steps.density.action({ query })).toEqual({ ok: true, products: { buckets } });
	});

	it("keeps the rows of a graph query written at or after a time, or before it", async () => {
		const world = getTestWorldWithOptions();
		const store = world.shared.getStore();
		const comment = (id: string, generatedAtTime: string) => ({ id, author: "did:site:0", generatedAtTime, accessLevel: Access.public });
		await store.upsertIndividual("Comment", comment("early", "2026-01-01T00:00:00.000Z"));
		await store.upsertIndividual("Comment", comment("late", "2026-03-01T00:00:00.000Z"));
		const query = JSON.stringify({ label: "Comment" });
		const lines = [`since "2026-02-01", graph query ${query}`, `before "2026-02-01", graph query ${query}`];
		const ran = await testWithWorld(world, lines.join("\n"), [Haibun, ResourcesStepper, GraphSourceStepper, LogicStepper]);
		expect(ran.ok, JSON.stringify(ran.failure)).toBe(true);
		const ids = (line: string) => {
			const products = (ran.world.runtime.stepResults as TStepResult[]).find((step) => step.in === line)?.products as { vertices: { id: string }[] } | undefined;
			if (products === undefined) throw new Error(`the line ${line} didn't return products`);
			return products.vertices.map(({ id }) => id);
		};
		expect(ids(itemAt(lines, 0))).toEqual(["late"]);
		expect(ids(itemAt(lines, 1))).toEqual(["early"]);
	});

	it("reads the rows of a graph query in the order, from the offset and to the limit its list combinators state, where the query doesn't state them", () => {
		const { takesListQuery } = new GraphSourceStepper().steps.graphQuery;
		const order = { field: "generatedAtTime", descending: true };
		expect(takesListQuery({ query: { label: "Comment" } }, { order, skip: 1, limit: 2 })).toEqual({
			query: { label: "Comment", sortBy: "generatedAtTime", sortOrder: "desc", offset: 1, limit: 2 },
		});
		expect(takesListQuery({ query: { label: "Comment", limit: 5 } }, { limit: 2 }), "a query's own page stays its list").toBeUndefined();
		expect(takesListQuery({ query: { label: "Comment", sortBy: "name" } }, { order }), "a query's own order stays its list").toBeUndefined();
		expect(takesListQuery({ query: { label: "Comment", named: ["a"] } }, { order }), "a named read orders by its names").toBeUndefined();
		expect(takesListQuery({ query: { label: "Comment" } }, { limit: 0 }), "a page holds a record at least").toBeUndefined();
	});

	it("limits and orders the rows at the store, with the store's count of every row, as a line, as a call that states its statement as a call, and as calls nested", async () => {
		const world = getTestWorldWithOptions();
		const store = world.shared.getStore();
		for (const [id, generatedAtTime] of [
			["early", "2026-01-01T00:00:00.000Z"],
			["late", "2026-03-01T00:00:00.000Z"],
		])
			await store.upsertIndividual("Comment", { id, author: "did:site:0", generatedAtTime, accessLevel: Access.public });
		const line = `limited to 1, ordered by "generatedAtTime", graph query ${JSON.stringify({ label: "Comment" })}`;
		const ran = await testWithWorld(world, line, [Haibun, ResourcesStepper, GraphSourceStepper, LogicStepper]);
		expect(ran.ok, JSON.stringify(ran.failure)).toBe(true);
		const rows = (products: unknown) => z.object({ vertices: z.array(z.object({ id: z.string() })), total: z.number() }).parse(products);
		const lined = rows((ran.world.runtime.stepResults as TStepResult[]).find((step) => step.in === line)?.products);
		expect({ ids: lined.vertices.map(({ id }) => id), total: lined.total }).toEqual({ ids: ["early"], total: 2 });
		const statement = { method: "GraphSourceStepper-graphQuery", params: { query: { label: "Comment" } } };
		const called = await runAuthorizedWith(RUN_AUTHORITY, () =>
			callStatedStepFrom({ getWorld: () => ran.world, steppers: ran.world.runtime.steppers ?? [] }, "Haibun-limitedTo", { count: 1, statement }),
		);
		expect(called.result.ok, JSON.stringify(called.result)).toBe(true);
		expect(rows(called.result.products).total).toBe(2);
		const ordered = { method: "Haibun-orderedBy", params: { field: "generatedAtTime", statement } };
		const skipped = { method: "Haibun-skipping", params: { count: 1, statement: ordered } };
		const nested = await runAuthorizedWith(RUN_AUTHORITY, () =>
			callStatedStepFrom({ getWorld: () => ran.world, steppers: ran.world.runtime.steppers ?? [] }, "Haibun-limitedTo", { count: 1, statement: skipped }),
		);
		expect(nested.result.ok, JSON.stringify(nested.result)).toBe(true);
		const page = rows(nested.result.products);
		expect({ ids: page.vertices.map(({ id }) => id), total: page.total }, "a call that states a combinator's call as its statement").toEqual({ ids: ["late"], total: 2 });
	});
});
