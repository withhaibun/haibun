/**
 * The specification of every quad store: the store in memory, the page's IndexedDB, the store another instance serves,
 * and a consumer's graph engine. A view reads the graph through `IQuadStore` and doesn't depend on the store under it, so
 * each store runs these cases. Core exports the suite, since the contract is core's. A consumer runs it against its own store.
 *
 * The suite declares the types `Comment` and `Issue`, with two relations from a comment to an issue, and builds each store
 * over those declarations. A type states `generatedAtTime`, the time every persisted type states, and `status`. The density
 * cases group records by `status`.
 *
 * An authoritative store requires the identity field a type declares, and a page holds what it read under its `@id`. Each
 * store tests its own identity rule in its own suite.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { GraphQuerySchema, VIA_FIELD, type IQuadStore, type TQuad, type TSearchCondition } from "../quad-types.js";
import { COUNT_CEILING, MAX_PAGE_ROWS, readInPages } from "../hypermedia.js";
import { Access, AccessLevelSchema, EDGE, LinkRelations, type TRegisteredDomain } from "../resources.js";

/** The types the suite declares. */
export const CONFORMANCE_TYPES = { comment: "Comment", issue: "Issue" } as const;
/** The relations from a comment to an issue. A comment reaches its issue through one or both. */
export const CONFORMANCE_RELATIONS = { about: EDGE.hasTarget, mentions: EDGE.mentions } as const;

const COMMENT = CONFORMANCE_TYPES.comment;
const ISSUE = CONFORMANCE_TYPES.issue;
const { about: ABOUT, mentions: MENTIONS } = CONFORMANCE_RELATIONS;

const RecordSchema = z
	.object({
		id: z.string(),
		content: z.string().optional(),
		author: z.string().optional(),
		status: z.string().optional(),
		generatedAtTime: z.string().optional(),
		accessLevel: AccessLevelSchema.optional(),
	})
	.strict();

/** Returns the declaration of one of the suite's types. `edges` are its relations. */
const domainOf = (persistedAs: string, edges: Record<string, { range: string }>): TRegisteredDomain => ({
	selectors: [`conformance-${persistedAs.toLowerCase()}`],
	schema: RecordSchema,
	coerce: (proto) => RecordSchema.parse(proto.value),
	description: `${persistedAs} of the quad store specification`,
	topology: {
		persistedAs,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			content: LinkRelations.CONTENT.rel,
			author: LinkRelations.ATTRIBUTED_TO.rel,
			// A context rel is a facet, which a store compares, so the density cases group by it.
			status: LinkRelations.CONTEXT.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			accessLevel: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges,
	},
});

/** The declarations every store under the suite holds. */
export const CONFORMANCE_DOMAINS: Record<string, TRegisteredDomain> = {
	"conformance-comment": domainOf(COMMENT, { [ABOUT]: { range: ISSUE }, [MENTIONS]: { range: ISSUE } }),
	"conformance-issue": domainOf(ISSUE, {}),
};

/** How a store differs from the others by design. */
type TStoreNature = {
	/** False for an authoritative store, which keeps what it holds and doesn't discard a graph. */
	discards?: boolean;
	/** True for a store that searches text. A store that doesn't search refuses a term. */
	searches?: boolean;
};

const sorted = (quads: TQuad[]): string[] => quads.map((q) => `${q.namedGraph}|${q.subject}|${q.predicate}=${JSON.stringify(q.object)}`).sort();

/** Returns a read request with its defaults. */
const query = (fields: Record<string, unknown>) => GraphQuerySchema.parse(fields);

/** Returns the `id` field of each record of a page. */
const idsOf = (vertices: ReadonlyArray<Record<string, unknown>>): unknown[] => vertices.map((vertex) => vertex.id);

/**
 * Runs the specification against one store. `make` returns a store over `CONFORMANCE_DOMAINS`, ready to read and write.
 * `prepare` runs before each case and `done` after it, for a store that needs its own setup.
 */
export function describeQuadStore(
	name: string,
	make: (domains: Record<string, TRegisteredDomain>) => IQuadStore | Promise<IQuadStore>,
	hooks: { prepare?: () => Promise<void> | void; done?: () => Promise<void> | void; nature?: TStoreNature } = {},
): void {
	const GRAPH = COMMENT;
	const OTHER = ISSUE;
	const discards = hooks.nature?.discards !== false;
	describe(`the quad store (${name})`, () => {
		let store: IQuadStore;
		beforeEach(async () => {
			await hooks.prepare?.();
			store = await make(CONFORMANCE_DOMAINS);
			if (discards) await store.clear();
			return async () => {
				await hooks.done?.();
			};
		});

		it("reads back what it was given, by subject and by named graph", async () => {
			await store.set("c1", "content", "hello", GRAPH);
			await store.set("c1", "author", "did:example:a", GRAPH);
			expect(await store.get("c1", "content", GRAPH)).toBe("hello");
			// A store with a schema holds the fields the type declares, and a store without one holds the fields written. Both
			// hold the facts set here.
			expect(sorted(await store.query({ subject: "c1", namedGraph: GRAPH }))).toEqual(
				expect.arrayContaining([`${GRAPH}|c1|author="did:example:a"`, `${GRAPH}|c1|content="hello"`]),
			);
			expect((await store.query({ namedGraph: GRAPH, predicate: "content" })).length).toBe(1);
		});

		it("replaces a fact set again, and doesn't add a second row for it", async () => {
			await store.set("c1", "content", "first", GRAPH);
			await store.set("c1", "content", "second", GRAPH);
			expect((await store.query({ subject: "c1", predicate: "content", namedGraph: GRAPH })).length).toBe(1);
			expect(await store.get("c1", "content", GRAPH)).toBe("second");
		});

		it("keeps named graphs apart: the same subject and predicate in two graphs are two facts", async () => {
			await store.set("x", "content", "in the first", GRAPH);
			await store.set("x", "content", "in the second", OTHER);
			expect(await store.get("x", "content", GRAPH)).toBe("in the first");
			expect(await store.get("x", "content", OTHER)).toBe("in the second");
		});

		it("rejects a page read whose limit exceeds MAX_PAGE_ROWS, and the error names the read, the limit and the maximum", async () => {
			const over = MAX_PAGE_ROWS + 1;
			const rejected = `queryIndividuals rejects a limit of ${over} rows: a page holds 1 to ${MAX_PAGE_ROWS} rows`;
			await expect(store.queryIndividuals(GRAPH, undefined, { limit: over })).rejects.toThrow(rejected);
		});

		it("returns undefined and an empty list for a subject it doesn't hold", async () => {
			expect(await store.get("missing", "content", GRAPH)).toBeUndefined();
			expect(await store.query({ subject: "missing", namedGraph: GRAPH })).toEqual([]);
		});

		it("matches a pattern on any of subject, predicate, object and named graph", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("a", "author", "did:example:a", GRAPH);
			await store.set("b", "content", "one", OTHER);
			expect((await store.query({ predicate: "content" })).length).toBe(2);
			expect((await store.query({ object: "one" })).length).toBe(2);
			expect((await store.query({ subject: "a", predicate: "author" })).length).toBe(1);
			expect((await store.query({ namedGraph: OTHER, predicate: "content" })).length).toBe(1);
		});

		describe("how many records fall in each division of a span", () => {
			const at = (minute: number): string => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
			const span = { label: GRAPH, timeField: "generatedAtTime", groupBy: "status", from: at(0), to: at(60), filters: [] as TSearchCondition[] };
			const held = async (records: Array<{ id: string; minute: number; status?: string }>): Promise<void> => {
				for (const r of records) await store.upsertIndividual(GRAPH, { id: r.id, generatedAtTime: at(r.minute), ...(r.status === undefined ? {} : { status: r.status }) });
			};

			// The result holds the stated count of buckets whatever the span holds, so a read of a decade reads as much as a
			// read of an hour. The two cases below hold a span with records and a span without records.
			it("returns the stated count of buckets, each counting its records by status", async () => {
				await held([
					{ id: "a", minute: 1, status: "passed" },
					{ id: "b", minute: 2, status: "failed" },
					{ id: "c", minute: 3, status: "passed" },
					{ id: "d", minute: 59, status: "passed" },
				]);
				const { buckets } = await store.density({ ...span, buckets: 2 });
				expect(buckets.length).toBe(2);
				expect(buckets[0]).toEqual({ passed: 2, failed: 1 });
				expect(buckets[1]).toEqual({ passed: 1 });
			});

			it("returns empty buckets for a span that doesn't hold a record", async () => {
				const { buckets } = await store.density({ ...span, buckets: 3 });
				expect(buckets).toEqual([{}, {}, {}]);
			});

			it("counts only what the filters name", async () => {
				await held([
					{ id: "a", minute: 1, status: "passed" },
					{ id: "b", minute: 2, status: "failed" },
				]);
				const { buckets } = await store.density({ ...span, buckets: 1, filters: [{ predicate: "status", operator: "eq", value: "failed" }] });
				expect(buckets[0]).toEqual({ failed: 1 });
			});

			it("leaves out what falls outside the span", async () => {
				await held([
					{ id: "before", minute: -10, status: "passed" },
					{ id: "inside", minute: 30, status: "passed" },
					{ id: "after", minute: 120, status: "passed" },
				]);
				const { buckets } = await store.density({ ...span, buckets: 1 });
				expect(buckets[0]).toEqual({ passed: 1 });
			});
		});

		it("removes what a pattern names, and doesn't remove another quad", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("b", "content", "two", GRAPH);
			await store.set("c", "content", "three", OTHER);
			await store.remove({ subject: "a", namedGraph: GRAPH });
			expect(await store.get("a", "content", GRAPH), "the named quad is removed").toBeUndefined();
			expect(await store.get("b", "content", GRAPH), "another quad is unchanged").toBe("two");
			expect(await store.get("c", "content", OTHER)).toBe("three");
		});

		it(discards ? "discards one named graph, or every graph" : "keeps every graph after a clear of one named graph", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("c", "content", "three", OTHER);
			await store.clear(GRAPH);
			if (!discards) {
				expect(await store.get("a", "content", GRAPH), "the cleared graph").toBe("one");
				return;
			}
			expect(await store.get("a", "content", GRAPH), "the cleared graph").toBeUndefined();
			expect(await store.get("c", "content", OTHER), "and the other graph is held").toBe("three");
			await store.clear();
			expect(await store.all()).toEqual([]);
		});

		describe("reads records through readRecords", () => {
			const TIME = "2026-01-01T00:00:00.000Z";
			/** Writes comments that state one time and the issue they reach. A comment is public unless `privately` names it. */
			const held = async (comments: readonly string[], privately: readonly string[] = []): Promise<void> => {
				await store.upsertIndividual(ISSUE, { id: "i1", generatedAtTime: TIME, accessLevel: Access.public });
				for (const id of comments) await store.upsertIndividual(COMMENT, { id, generatedAtTime: TIME, status: "open", accessLevel: privately.includes(id) ? Access.private : Access.public });
			};
			/** Writes an edge from a comment to the issue. A store without `createEdge` holds an edge as a quad that states its object's type. */
			const relate = (from: string, relation: string): Promise<void> =>
				store.createEdge ? store.createEdge(COMMENT, from, relation, ISSUE, "i1") : store.add({ subject: from, predicate: relation, object: "i1", namedGraph: COMMENT, objectType: ISSUE });

			it("rejects a limit or a perType of 0 and of MAX_PAGE_ROWS + 1, and a count ceiling above COUNT_CEILING", async () => {
				for (const size of [0, MAX_PAGE_ROWS + 1]) {
					const rejected = `readRecords rejects a limit of ${size} rows: a page holds 1 to ${MAX_PAGE_ROWS} rows`;
					await expect(store.readRecords(query({ label: COMMENT, limit: size }))).rejects.toThrow(rejected);
					await expect(store.readRecords(query({ label: COMMENT, perType: size }))).rejects.toThrow(rejected);
				}
				await expect(store.readRecords(query({ label: COMMENT, countTo: COUNT_CEILING + 1 }))).rejects.toThrow(`readRecords rejects a count ceiling of ${COUNT_CEILING + 1}`);
			});

			it("states saturated where the count stops at countTo, and the page's count with skipCount", async () => {
				await held(["c1", "c2", "c3"]);
				const stopped = await store.readRecords(query({ label: COMMENT, countTo: 2 }));
				expect({ total: stopped.total, saturated: stopped.saturated }).toEqual({ total: 2, saturated: true });
				expect(stopped.vertices.length, "the count doesn't bound the page").toBe(3);
				const skipped = await store.readRecords(query({ label: COMMENT, limit: 2, skipCount: true }));
				expect({ total: skipped.total, saturated: skipped.saturated }).toEqual({ total: 2, saturated: true });
			});

			it("refuses a read without a label, term, reference or named records, a filter without a label, and a type it doesn't hold", async () => {
				await expect(store.readRecords(query({}))).rejects.toThrow("readRecords reads one type, a term across the types a search reads");
				const unlabelled = query({ references: { label: ISSUE, id: "i1" }, filters: [{ predicate: "status", operator: "eq", value: "open" }] });
				await expect(store.readRecords(unlabelled)).rejects.toThrow("readRecords compares a filter and a sort against one type's properties");
				await expect(store.readRecords(query({ label: "Unheld" }))).rejects.toThrow("readRecords reads a type this store holds, and Unheld isn't one of them");
			});

			it("refuses a filter and a sort on a field the type doesn't compare, and names the fields it compares", async () => {
				const compared = `It compares accessLevel, generatedAtTime, status, ${ABOUT}, ${MENTIONS}.`;
				await expect(store.readRecords(query({ label: COMMENT, filters: [{ predicate: "author", operator: "eq", value: "a" }] }))).rejects.toThrow(
					`readRecords(Comment) doesn't compare author. ${compared}`,
				);
				await expect(store.readRecords(query({ label: COMMENT, sortBy: "author" }))).rejects.toThrow("readRecords(Comment) doesn't compare author. It compares accessLevel, generatedAtTime, status.");
			});

			it("refuses a relation compared by an operator other than eq or in, and a relation the store doesn't hold", async () => {
				const compared = query({ label: COMMENT, filters: [{ predicate: ABOUT, operator: "gt", value: "i1" }] });
				await expect(store.readRecords(compared)).rejects.toThrow(`Comment.${ABOUT} is a relation: a filter names the record at its other end with eq or in, not gt`);
				await expect(store.readRecords(query({ references: { label: ISSUE, id: "i1", via: ["unheld"] } }))).rejects.toThrow(`a relation named "unheld" doesn't reach a record in this graph`);
			});

			if (hooks.nature?.searches !== true)
				it("refuses a term, and names the filter, relation and id routes that reach the type", async () => {
					await expect(store.readRecords(query({ label: COMMENT, textQuery: "open" }))).rejects.toThrow(
						`readRecords(Comment): this store doesn't search text. Compared by a filter: accessLevel, generatedAtTime, status. A filter names by its id the record at the other end of: ${ABOUT} (Issue), ${MENTIONS} (Issue). Addressed by: id.`,
					);
				});

			it("orders records of one time by id, so a read a record at a time returns each once, in the same order twice", async () => {
				await held(["c2", "c3", "c1"]);
				const walk = async (): Promise<unknown[]> => {
					const ids: unknown[] = [];
					for (const offset of [0, 1, 2]) {
						const page = await store.readRecords(query({ label: COMMENT, sortOrder: "asc", limit: 1, offset }));
						expect(page.order.at(-1), "the last key orders by the record's id").toEqual({ key: "@id", order: "asc" });
						ids.push(...idsOf(page.vertices));
					}
					return ids;
				};
				expect(await walk()).toEqual(["c1", "c2", "c3"]);
				expect(await walk()).toEqual(["c1", "c2", "c3"]);
			});

			it("walks two pages with readInPages and returns every record once, with the last page's count", async () => {
				await held(["c2", "c3", "c1"]);
				const read = (from: number, to: number) => store.readRecords(query({ label: COMMENT, sortOrder: "asc", offset: from, limit: to - from }));
				const walked = await readInPages(read, 0, MAX_PAGE_ROWS, 2);
				expect(idsOf(walked.vertices)).toEqual(["c1", "c2", "c3"]);
				expect({ total: walked.total, saturated: walked.saturated }).toEqual({ total: 3, saturated: false });
			});

			it("reads named records in the order named, and leaves out an id it doesn't hold", async () => {
				await held(["c1", "c2", "c3"]);
				const page = await store.readRecords(query({ label: COMMENT, named: ["c3", "absent", "c1"] }));
				expect(idsOf(page.vertices)).toEqual(["c3", "c1"]);
				expect(page.order.map(({ key }) => key)).toEqual(["named", "@id"]);
			});

			it("reads references in both directions, and counts a record two relations reach once, with both in _via", async () => {
				await held(["c1", "c2"]);
				await relate("c1", ABOUT);
				await relate("c1", MENTIONS);
				await relate("c2", ABOUT);
				const referencing = await store.readRecords(query({ references: { label: ISSUE, id: "i1" } }));
				expect(idsOf(referencing.vertices)).toEqual(["c1", "c2"]);
				expect(referencing.total).toBe(2);
				expect(referencing.vertices.map((vertex) => vertex[VIA_FIELD])).toEqual([[ABOUT, MENTIONS], [ABOUT]]);
				const through = await store.readRecords(query({ references: { label: ISSUE, id: "i1", via: [MENTIONS] } }));
				expect(idsOf(through.vertices)).toEqual(["c1"]);
				const referenced = await store.readRecords(query({ referencedBy: { label: COMMENT, id: "c1" } }));
				expect(idsOf(referenced.vertices)).toEqual(["i1"]);
				expect(referenced.vertices[0]?.[VIA_FIELD]).toEqual([ABOUT, MENTIONS]);
			});

			it("compares a relation filter by the id at the relation's other end", async () => {
				await held(["c1", "c2"]);
				await relate("c1", MENTIONS);
				const page = await store.readRecords(query({ label: COMMENT, filters: [{ predicate: MENTIONS, operator: "eq", value: "i1" }] }));
				expect(idsOf(page.vertices)).toEqual(["c1"]);
			});

			it("doesn't return a private record to a read at the public level", async () => {
				await held(["c1", "c2"], ["c2"]);
				const page = await store.readRecords(query({ label: COMMENT, accessLevel: Access.public }));
				expect(idsOf(page.vertices)).toEqual(["c1"]);
			});
		});
	});
}
