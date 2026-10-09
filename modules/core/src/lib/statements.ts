/**
 * Reads the statements the graph holds and the provenance of each.
 *
 * A statement is a subject, a predicate and an object. statementsWith reads the statements of one predicate. It returns
 * each statement with the reading that asserted it, the outermost recorded step that contains the reading's step, and
 * that outermost step's status. Each party in a row is a reference (`@id` + `@type`) and not a copied display string.
 * A view renders each cell as a link: the subject, the passage, the reading and the step of actuality.
 *
 * This module doesn't store a record. It projects what the store holds as RDF reification (`rdf:Statement`, subject,
 * predicate, object) with provenance. A coverage table is this read with the citation predicate and not a separate
 * report. Each row of the table holds a cited requirement and the status of the outermost step that contains the
 * citing step.
 */
import { READING_LABEL, LinkRelations, SEQ_PATH_LABEL, StatedRecordSchema } from "./resources.js";
import { fromJsonText } from "./json-text.js";
import { SEQ_PATH_FIELD, SEQ_PATH_EDGE } from "./seq-path.js";
import type { IQuadStore } from "./quad-types.js";
import { readEvery, recordOf } from "./records/pipelines/record-reads.js";

/** A JSON-LD reference to an individual: its `@id` and its `@type`. */
export type TReference = { "@id": string; "@type": string };

/** One statement and its provenance. `assertedBy` is the outermost recorded step that contains the step of the
 *  asserting reading. `outcome` is that outermost step's status. */
export type TStatementRow = {
	"@type": "rdf:Statement";
	subject: TReference;
	predicate: string;
	object: TReference;
	reading?: TReference;
	assertedBy?: TReference;
	outcome?: string;
};

/** The store methods this read calls: quads by pattern, and the read of records. */
type TStatementStore = Pick<IQuadStore, "query" | "readRecords">;

/** A quad as the stores return it: the subject's type is its named graph, and an edge names its target's type. */
type TEdgeQuad = { subject: string; predicate: string; object: unknown; namedGraph?: string; objectType?: string };

/** Maps the subject, predicate and object of each edge a reading states to that reading. It reads the `stated` records
 *  of each reading. */
async function readingsByStatement(store: TStatementStore): Promise<Map<string, string>> {
	const byStatement = new Map<string, string>();
	for (const reading of await readEvery(store, { label: READING_LABEL })) {
		for (const entry of Array.isArray(reading.stated) ? (reading.stated as string[]) : []) {
			const record = fromJsonText(StatedRecordSchema).parse(entry);
			if (record.kind === "edge") byStatement.set(`${record.s}\u0000${record.rel}\u0000${record.o}`, String(reading.id));
		}
	}
	return byStatement;
}

/** Returns the outermost recorded ancestor of a step, or the step where a recorded parent doesn't exist. A walk over a
 *  cycle of `isPartOf` edges stops at a depth of 100. */
async function runOf(store: TStatementStore, seqPathId: string): Promise<Record<string, unknown> | undefined> {
	let current = await recordOf(store, SEQ_PATH_LABEL, seqPathId);
	for (let depth = 0; current && depth < 100; depth++) {
		const parent = (await store.query({ subject: String(current[SEQ_PATH_FIELD.id]), predicate: SEQ_PATH_EDGE.isPartOf })).map((q) => String(q.object))[0];
		if (!parent) return current;
		const next = await recordOf(store, SEQ_PATH_LABEL, parent);
		if (!next) return current;
		current = next;
	}
	return current;
}

/**
 * Returns each edge made with `predicate` as a statement, in the order the store returns its quads. A row references
 * the reading that asserted the statement and the outermost recorded step that contains the reading's step. It holds
 * that outermost step's status as `outcome`. A reading's `stated` records don't hold a statement asserted by hand. That
 * statement is still a row, and the row doesn't reference a reading.
 */
export async function statementsWith(store: TStatementStore, predicate: string): Promise<TStatementRow[]> {
	const quads = (await store.query({ predicate })) as TEdgeQuad[];
	const readings = await readingsByStatement(store);
	const rows: TStatementRow[] = [];
	for (const quad of quads) {
		const objectType = quad.objectType;
		// A quad without a target type is a literal property and doesn't relate the subject to another individual.
		if (!objectType) continue;
		const row: TStatementRow = {
			"@type": "rdf:Statement",
			subject: { "@id": quad.subject, "@type": String(quad.namedGraph ?? "") },
			predicate,
			object: { "@id": String(quad.object), "@type": objectType },
		};
		const readingId = readings.get(`${quad.subject}\u0000${predicate}\u0000${String(quad.object)}`);
		if (readingId) {
			row.reading = { "@id": readingId, "@type": READING_LABEL };
			const seqPathId = (await recordOf(store, READING_LABEL, readingId))?.seqPath;
			if (typeof seqPathId === "string") {
				const run = await runOf(store, seqPathId);
				row.assertedBy = { "@id": String(run?.[SEQ_PATH_FIELD.id] ?? seqPathId), "@type": SEQ_PATH_LABEL };
				if (run?.[SEQ_PATH_FIELD.actionStatus]) row.outcome = String(run[SEQ_PATH_FIELD.actionStatus]);
			}
		}
		rows.push(row);
	}
	return rows;
}

/** Returns every rel in LinkRelations whose range is an IRI and that isn't abstract. A reader picks a predicate from
 *  this list and doesn't guess one. */
export function statementPredicates(): string[] {
	return Object.values(LinkRelations)
		.filter((entry) => entry.range === "iri" && !(entry as { abstract?: boolean }).abstract)
		.map((entry) => entry.rel);
}
