/**
 * Reads the statements the graph holds and the provenance of each.
 *
 * A statement is a subject, a predicate and an object. statementsWith reads the statements of one predicate. It returns
 * each statement with the reading that asserted it, the line that contains the reading's step, and that line's status.
 * Each party in a row is a reference (`@id` + `@type`) and not a copied display string. A view renders each cell as a
 * link: the subject, the passage, the reading and the step of actuality.
 *
 * This module doesn't store a record. It projects what the store holds as RDF reification (`rdf:Statement`, subject,
 * predicate, object) with provenance. A coverage table is this read with the citation predicate and not a separate
 * report. Each row of the table holds a cited requirement and the status of the line that contains the citing step.
 */
import { RDF_STATEMENT } from "../../domains/vocabularies.js";
import { READING_LABEL, SEQ_PATH_LABEL, StatedRecordSchema } from "../../domains/resources.js";
import { fromJsonText } from "../../domains/json-text.js";
import { SEQ_PATH_FIELD, formatRecordName, linePathOf, parseRecordName } from "../../actuality/domains/seq-path.js";
import type { IQuadStore } from "../ports.js";
import { readEvery, recordOf } from "../../records/pipelines/record-reads.js";

/** A JSON-LD reference to an individual: its `@id` and its `@type`. */
export type TReference = { "@id": string; "@type": string };

/** One statement and its provenance. `assertedBy` is the line that contains the step of the asserting reading. `outcome`
 *  is that line's status. */
export type TStatementRow = {
	"@type": typeof RDF_STATEMENT;
	subject: TReference;
	predicate: string;
	object: TReference;
	reading?: TReference;
	assertedBy?: TReference;
	outcome?: string;
};

/** The store methods this read calls: quads by pattern, and the read of records. */
type TStatementStore = Pick<IQuadStore, "query" | "readRecords">;

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

/** The line that contains a reading's step, by the record name the reading states, with the line's status where the
 *  store holds its record. Throws where the reading doesn't state a step's record name. */
async function lineOf(store: TStatementStore, readingId: string, seqPath: string): Promise<Pick<TStatementRow, "assertedBy" | "outcome">> {
	const step = parseRecordName(seqPath);
	if (step === undefined)
		throw new Error(`the reading ${readingId} states the step ${seqPath}, which isn't a step's record name; read its passage again, so its reading states one`);
	const line = formatRecordName({ ...step, path: linePathOf(step.path) });
	const status = (await recordOf(store, SEQ_PATH_LABEL, line))?.[SEQ_PATH_FIELD.actionStatus];
	return { assertedBy: { "@id": line, "@type": SEQ_PATH_LABEL }, ...(status === undefined ? {} : { outcome: String(status) }) };
}

/**
 * Returns each edge made with `predicate` as a statement, in the order the store returns its quads. A row references
 * the reading that asserted the statement and the line that contains the reading's step. It holds that line's status as
 * `outcome`. A reading's `stated` records don't hold a statement asserted by hand. That statement is still a row, and the
 * row doesn't reference a reading.
 */
export async function statementsWith(store: TStatementStore, predicate: string): Promise<TStatementRow[]> {
	const quads = await store.query({ predicate });
	const readings = await readingsByStatement(store);
	const rows: TStatementRow[] = [];
	for (const quad of quads) {
		const objectType = quad.objectType;
		// A quad without a target type is a literal property and doesn't relate the subject to another individual.
		if (!objectType) continue;
		const row: TStatementRow = {
			"@type": RDF_STATEMENT,
			subject: { "@id": quad.subject, "@type": quad.namedGraph },
			predicate,
			object: { "@id": String(quad.object), "@type": objectType },
		};
		const readingId = readings.get(`${quad.subject}\u0000${predicate}\u0000${String(quad.object)}`);
		if (readingId) {
			row.reading = { "@id": readingId, "@type": READING_LABEL };
			const seqPath = (await recordOf(store, READING_LABEL, readingId))?.seqPath;
			if (typeof seqPath === "string") Object.assign(row, await lineOf(store, readingId, seqPath));
		}
		rows.push(row);
	}
	return rows;
}
