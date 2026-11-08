/**
 * The specification of every quad store: the store in memory, the page's IndexedDB, the store another instance serves,
 * and a consumer's graph engine. A view reads the graph through `IQuadStore` and doesn't depend on the store under it, so
 * each store runs these cases. Core exports the suite, since the contract is core's. A consumer runs it against its own store.
 *
 * The suite declares the types `Comment` and `Issue`, with two relations from a comment to an issue and one from an issue
 * to the issue that contains it, and builds each store over those declarations. A type states `generatedAtTime`, the time every
 * persisted type states, and `status`. The density cases group records by `status`.
 *
 * An authoritative store requires the identity field a type declares, and a page holds what it read under its `@id`. Each
 * store tests its own identity rule in its own suite.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { GraphQuerySchema, VIA_FIELD, type TQuad, type TSearchCondition } from "../steps/domains/quad-types.js";
import { type IQuadStore } from "../steps/ports.js";
import { COUNT_CEILING, MAX_PAGE_ROWS, readInPages } from "../domains/hypermedia.js";
import { Access, AccessLevelSchema, EDGE, LinkRelations, type TRegisteredDomain } from "../domains/resources.js";
import { ChangedSinceRead, NotUnique } from "../records/domains/unit.js";
import { rereadAndRetry } from "../records/pipelines/record-versions.js";

/** The types the suite declares. */
export const CONFORMANCE_TYPES = { comment: "Comment", issue: "Issue" } as const;
/** The relations from a comment to an issue, and from an issue to the issue that contains it. A comment reaches its issue
 *  through one or both. */
export const CONFORMANCE_RELATIONS = { about: EDGE.hasTarget, mentions: EDGE.mentions, partOf: EDGE.isPartOf } as const;

const COMMENT = CONFORMANCE_TYPES.comment;
const ISSUE = CONFORMANCE_TYPES.issue;
const { about: ABOUT, mentions: MENTIONS, partOf: PART_OF } = CONFORMANCE_RELATIONS;

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

/** Returns the declaration of one of the suite's types. `edges` are its relations, and `unique` the sets of its properties that
 *  two of its records don't share. */
const domainOf = (persistedAs: string, edges: Record<string, { range: string; reference?: true }>, unique?: readonly (readonly string[])[]): TRegisteredDomain => ({
	selectors: [`conformance-${persistedAs.toLowerCase()}`],
	schema: RecordSchema,
	coerce: (proto) => RecordSchema.parse(proto.value),
	description: `${persistedAs} of the quad store specification`,
	topology: {
		persistedAs,
		accessLevel: Access.private,
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
		...(unique === undefined ? {} : { unique }),
	},
});

/** The declarations every store under the suite holds. */
export const CONFORMANCE_DOMAINS: Record<string, TRegisteredDomain> = {
	"conformance-comment": domainOf(COMMENT, { [ABOUT]: { range: ISSUE }, [MENTIONS]: { range: ISSUE } }),
	"conformance-issue": domainOf(ISSUE, { [PART_OF]: { range: ISSUE, reference: true } }, [["author", "status"]]),
};

/** How a store differs from the others by design. */
type TStoreNature = {
	/** False for an authoritative store, which keeps what it holds and doesn't discard a graph. */
	discards?: boolean;
	/** True for a store that searches text. A store that doesn't search refuses a term. */
	searches?: boolean;
	/** True for a store that reads quads only by a key: a subject, or a relation and the record it reaches. It refuses a
	 *  pattern without one and a read of every quad, since it holds every record of every type. */
	keyed?: boolean;
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
	const keyed = hooks.nature?.keyed === true;
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
			await store.merge({ "@type": GRAPH, id: "c1", content: "hello" });
			await store.merge({ "@type": GRAPH, "@id": "c1", author: "did:example:a" });
			expect(await store.get("c1", "content", GRAPH)).toBe("hello");
			// A store with a schema holds the fields the type declares, and a store without one holds the fields written. Both
			// hold the facts set here.
			expect(sorted(await store.query({ subject: "c1", namedGraph: GRAPH }))).toEqual(
				expect.arrayContaining([`${GRAPH}|c1|author="did:example:a"`, `${GRAPH}|c1|content="hello"`]),
			);
			expect((await store.query({ subject: "c1", namedGraph: GRAPH, predicate: "content" })).length).toBe(1);
		});

		it("writes a unit that states the version its caller read, and refuses one whose record changed since, naming both versions", async () => {
			const name = { label: GRAPH, id: "versioned" };
			expect(await store.versionOf(name), "a record the store doesn't hold").toBeNull();
			await store.create({ "@type": GRAPH, id: "versioned", content: "first" });
			const read = await store.versionOf(name);
			expect(read).not.toBeNull();
			await expect(store.create({ "@type": GRAPH, id: "versioned", content: "again" }), "a unit written as if the record weren't held").rejects.toThrow(ChangedSinceRead);
			await store.update({ "@type": GRAPH, "@id": "versioned", content: "second" }, read);
			const held = await store.versionOf(name);
			expect(held).not.toBe(read);
			const refused = store.update({ "@type": GRAPH, "@id": "versioned", content: "stale" }, read);
			await expect(refused).rejects.toThrow(`${GRAPH} "versioned" changed since it was read: the write states version ${read}, and the store holds version ${held}`);
			expect(await store.get("versioned", "content", GRAPH), "the refused unit isn't written").toBe("second");
		});

		it("keeps the change of each of two writers that read, change and write one record at once", async () => {
			await store.merge({ "@type": GRAPH, id: "counted", content: "" });
			const append = (mark: string) =>
				rereadAndRetry(3, async () => {
					// The version is read before the record, as `readVersioned` reads it.
					const version = await store.versionOf({ label: GRAPH, id: "counted" });
					const content = String(await store.get("counted", "content", GRAPH));
					await store.update({ "@type": GRAPH, "@id": "counted", content: `${content}${mark}` }, version);
				});
			await Promise.all([append("a"), append("b")]);
			expect(
				String(await store.get("counted", "content", GRAPH))
					.split("")
					.sort(),
			).toEqual(["a", "b"]);
		});

		if (!discards)
			it("refuses a record that holds another record's values of a set its type declares unique, and gives the values to one of records written at once", async () => {
				await store.merge({ "@type": OTHER, id: "u1", author: "did:example:a", status: "open" });
				await store.merge({ "@type": OTHER, id: "u2", author: "did:example:a" });
				await store.merge({ "@type": OTHER, id: "u3", author: "did:example:b", status: "open" });
				await expect(store.merge({ "@type": OTHER, "@id": "u2", status: "open" })).rejects.toThrow(
					`${OTHER} "u2" isn't written: another ${OTHER} holds author "did:example:a" and status "open", which its type declares unique`,
				);
				expect(await store.get("u2", "status", OTHER), "the refused unit isn't written").toBeUndefined();
				const atOnce = await Promise.allSettled(["u4", "u5", "u6"].map((id) => store.merge({ "@type": OTHER, id, author: "did:example:c", status: "open" })));
				expect(atOnce.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected", "rejected"]);
				for (const outcome of atOnce) if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(NotUnique);
			});

		it("replaces a fact set again, and doesn't add a second row for it", async () => {
			await store.merge({ "@type": GRAPH, id: "c1", content: "first" });
			await store.merge({ "@type": GRAPH, "@id": "c1", content: "second" });
			expect((await store.query({ subject: "c1", predicate: "content", namedGraph: GRAPH })).length).toBe(1);
			expect(await store.get("c1", "content", GRAPH)).toBe("second");
		});

		it("keeps named graphs apart: the same subject and predicate in two graphs are two facts", async () => {
			await store.merge({ "@type": GRAPH, id: "x", content: "in the first" });
			await store.merge({ "@type": OTHER, id: "x", content: "in the second" });
			expect(await store.get("x", "content", GRAPH)).toBe("in the first");
			expect(await store.get("x", "content", OTHER)).toBe("in the second");
		});

		it("returns undefined and an empty list for a subject it doesn't hold", async () => {
			expect(await store.get("missing", "content", GRAPH)).toBeUndefined();
			expect(await store.query({ subject: "missing", namedGraph: GRAPH })).toEqual([]);
		});

		it(
			keyed ? "matches a pattern by its key, and refuses one without a key or a read of every quad" : "matches a pattern on any of subject, predicate, object and named graph",
			async () => {
				await store.merge({ "@type": GRAPH, id: "a", content: "one" });
				await store.merge({ "@type": GRAPH, "@id": "a", author: "did:example:a" });
				await store.merge({ "@type": OTHER, id: "b", content: "one" });
				expect((await store.query({ subject: "a", predicate: "author" })).length).toBe(1);
				expect((await store.query({ subject: "b", namedGraph: OTHER, predicate: "content" })).length).toBe(1);
				if (keyed) {
					await expect(store.query({ predicate: "content" })).rejects.toThrow("reads quads by a key");
					await expect(store.query({ object: "one" })).rejects.toThrow("reads quads by a key");
					await expect(store.all()).rejects.toThrow("in pages through readRecords");
					return;
				}
				expect((await store.query({ predicate: "content" })).length).toBe(2);
				expect((await store.query({ object: "one" })).length).toBe(2);
				expect((await store.query({ namedGraph: OTHER, predicate: "content" })).length).toBe(1);
			},
		);

		it("reads the records whose relation reaches a record, by that record's id", async () => {
			await store.merge({ "@type": ISSUE, id: "i1", accessLevel: Access.public });
			await store.merge({ "@type": COMMENT, id: "c1", content: "about it", accessLevel: Access.public });
			await store.merge({ "@type": COMMENT, id: "c2", content: "about something else", accessLevel: Access.public });
			await store.merge({ "@type": COMMENT, "@id": "c1", [ABOUT]: { "@type": ISSUE, "@id": "i1" } });
			expect((await store.query({ predicate: ABOUT, object: "i1", namedGraph: COMMENT })).map((q) => q.subject)).toEqual(["c1"]);
		});

		describe("how many records fall in each division of a span", () => {
			const at = (minute: number): string => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
			const span = { label: GRAPH, timeField: "generatedAtTime", groupBy: "status", from: at(0), to: at(60), filters: [] as TSearchCondition[] };
			const held = async (records: Array<{ id: string; minute: number; status?: string }>): Promise<void> => {
				for (const r of records) await store.merge({ "@type": GRAPH, id: r.id, generatedAtTime: at(r.minute), ...(r.status === undefined ? {} : { status: r.status }) });
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
			await store.merge({ "@type": GRAPH, id: "a", content: "one" });
			await store.merge({ "@type": GRAPH, id: "b", content: "two" });
			await store.merge({ "@type": OTHER, id: "c", content: "three" });
			await store.remove({ label: GRAPH, id: "a" });
			expect(await store.get("a", "content", GRAPH), "the named quad is removed").toBeUndefined();
			expect(await store.get("b", "content", GRAPH), "another quad is unchanged").toBe("two");
			expect(await store.get("c", "content", OTHER)).toBe("three");
		});

		it(discards ? "discards one named graph, or every graph" : "keeps every graph after a clear of one named graph", async () => {
			await store.merge({ "@type": GRAPH, id: "a", content: "one" });
			await store.merge({ "@type": OTHER, id: "c", content: "three" });
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

		describe("samples each type's records in the order of their containment", () => {
			const at = (minute: number): string => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
			/** Writes a public record of `label` generated at `minute`. */
			const hold = (label: string, id: string, minute: number): Promise<string> => store.merge({ "@type": label, id, generatedAtTime: at(minute), accessLevel: Access.public });
			/** Writes the edge from an issue to the issue that contains it. The type declares the edge a reference, so a store that keeps
			 *  edges strictly holds a reference in place of an issue it doesn't hold. */
			const partOf = (part: string, whole: string): Promise<string> => store.merge({ "@type": ISSUE, "@id": part, [PART_OF]: { "@type": ISSUE, "@id": whole } });

			it("holds each issue after the issue it is part of, the issues with parts before the leaves, and counts the parts it leaves out under each", async () => {
				const parts = { "part-1": { minute: 1, leaves: [2, 3, 4] }, "part-2": { minute: 5, leaves: [6, 7, 8] } };
				await hold(ISSUE, "whole", 0);
				for (const [part, { minute, leaves }] of Object.entries(parts)) {
					await hold(ISSUE, part, minute);
					for (const leaf of leaves) await hold(ISSUE, `leaf-${leaf}`, leaf);
				}
				for (const [part, { leaves }] of Object.entries(parts)) {
					await partOf(part, "whole");
					for (const minute of leaves) await partOf(`leaf-${minute}`, part);
				}
				for (const minute of [1, 2, 3, 4, 5]) await hold(COMMENT, `c${minute}`, minute);
				const { clusters } = await store.getClusteredQuads({ perTypeLimit: 4, accessLevel: Access.public });
				expect(
					clusters.find((cluster) => cluster.type === ISSUE),
					"the whole, its parts by the declared sort, then the latest leaf",
				).toMatchObject({ sampledSubjects: ["whole", "part-2", "part-1", "leaf-8"], omittedCount: 5, omittedUnder: { "part-1": 3, "part-2": 2 } });
				const comments = clusters.find((cluster) => cluster.type === COMMENT);
				expect(comments, "a type without parts in its declared sort, the latest first").toMatchObject({ sampledSubjects: ["c5", "c4", "c3", "c2"], omittedCount: 1 });
				expect(comments?.omittedUnder).toBeUndefined();
			});

			it("holds an issue whose containment doesn't reach an issue the store holds, or returns to itself, after every issue of the held hierarchy", async () => {
				for (const [id, minute] of Object.entries({ part: 1, top: 2, leaf: 3, "loop-a": 4, "loop-b": 5 })) await hold(ISSUE, id, minute);
				await partOf("part", "absent");
				for (const [part, whole] of Object.entries({ leaf: "top", "loop-a": "loop-b", "loop-b": "loop-a" })) await partOf(part, whole);
				const { clusters } = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: Access.public });
				expect(
					clusters.find((cluster) => cluster.type === ISSUE)?.sampledSubjects,
					"the held hierarchy, then the loop's issues with parts, then the part of an absent issue",
				).toEqual(["top", "leaf", "loop-b", "loop-a", "part"]);
			});
		});

		describe("reads records through readRecords", () => {
			const TIME = "2026-01-01T00:00:00.000Z";
			/** Writes comments that state one time and the issue they reach. A comment is public unless `privately` names it. */
			const held = async (comments: readonly string[], privately: readonly string[] = []): Promise<void> => {
				await store.merge({ "@type": ISSUE, id: "i1", generatedAtTime: TIME, accessLevel: Access.public });
				for (const id of comments)
					await store.merge({ "@type": COMMENT, id, generatedAtTime: TIME, status: "open", accessLevel: privately.includes(id) ? Access.private : Access.public });
			};
			/** Writes an edge from a comment to the issue. */
			const relate = (from: string, relation: string): Promise<string> => store.merge({ "@type": COMMENT, "@id": from, [relation]: { "@type": ISSUE, "@id": "i1" } });

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
				await expect(store.readRecords(query({ label: COMMENT, sortBy: "author" }))).rejects.toThrow(
					"readRecords(Comment) doesn't compare author. It compares accessLevel, generatedAtTime, status.",
				);
			});

			it("refuses a relation compared by an operator other than eq or in, and a relation the store doesn't hold", async () => {
				const compared = query({ label: COMMENT, filters: [{ predicate: ABOUT, operator: "gt", value: "i1" }] });
				await expect(store.readRecords(compared)).rejects.toThrow(`Comment.${ABOUT} is a relation: a filter names the record at its other end with eq or in, not gt`);
				await expect(store.readRecords(query({ references: { label: ISSUE, id: "i1", via: ["unheld"] } }))).rejects.toThrow(
					`a relation named "unheld" doesn't reach a record in this graph`,
				);
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
