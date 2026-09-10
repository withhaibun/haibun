/**
 * Statements: reading the graph as the statements it holds, with where each one came from.
 *
 * A statement is a subject, a predicate, and an object. This reads them back for a given predicate and answers, for
 * each, which reading asserted it, in which run step, and how that step ended. Every party in a row is a REFERENCE
 * (`@id` + `@type`), never a copied display string, so a view renders each cell as something to open: the subject,
 * the passage, the reading, the run.
 *
 * Nothing here is stored: this is a projection of what the store already holds, shaped as RDF reification
 * (`rdf:Statement`, subject / predicate / object) plus provenance. A coverage table, which requirements a run
 * evidenced, and whether it passed, is this read with the citation predicate, not a report of its own.
 */
import { READING_LABEL, LinkRelations, SEQ_PATH_LABEL, type TDiscourseStore } from "./resources.js";
import { SEQ_PATH_FIELD, SEQ_PATH_EDGE, type TSeqPath } from "./seq-path.js";

/** A reference to an individual, as JSON-LD names one: what to open, and what kind of thing it is. */
export type TReference = { "@id": string; "@type": string };

/** One statement and its provenance. `assertedBy` is the run step that made it; `outcome` is how that step's run ended. */
export type TStatementRow = {
	"@type": "rdf:Statement";
	subject: TReference;
	predicate: string;
	object: TReference;
	reading?: TReference;
	assertedBy?: TReference;
	outcome?: string;
};

/** The store surface this read needs: quads by pattern, and individuals by id. */
type TStatementStore = Pick<TDiscourseStore, "query" | "getIndividual"> & {
	queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]>;
};

/** A quad as the stores return it: the subject's type is its named graph, and an edge names its target's type. */
type TEdgeQuad = { subject: string; predicate: string; object: unknown; namedGraph?: string; objectType?: string };

/** Which reading asserted which statement, keyed by what the statement says: the readings' own record, read back. */
async function readingsByStatement(store: TStatementStore): Promise<Map<string, string>> {
	const byStatement = new Map<string, string>();
	for (const reading of await store.queryIndividuals<{ id: string; stated?: unknown }>(READING_LABEL)) {
		for (const entry of Array.isArray(reading.stated) ? (reading.stated as string[]) : []) {
			const record = JSON.parse(String(entry)) as { kind: string; s?: string; rel?: string; o?: string };
			if (record.kind === "edge") byStatement.set(`${record.s}\u0000${record.rel}\u0000${record.o}`, reading.id);
		}
	}
	return byStatement;
}

/** The run a step belongs to: its outermost ancestor, whose status is the run's own. One walk, cycle-guarded by depth. */
async function runOf(store: TStatementStore, seqPathId: string): Promise<TSeqPath | undefined> {
	let current = await store.getIndividual<TSeqPath>(SEQ_PATH_LABEL, seqPathId);
	for (let depth = 0; current && depth < 100; depth++) {
		const parent = (await store.query({ subject: String(current[SEQ_PATH_FIELD.id]), predicate: SEQ_PATH_EDGE.isPartOf })).map((q) => String(q.object))[0];
		if (!parent) return current;
		const next = await store.getIndividual<TSeqPath>(SEQ_PATH_LABEL, parent);
		if (!next) return current;
		current = next;
	}
	return current;
}

/**
 * Every statement made with `predicate`, newest reading first, each with the reading that asserted it and how that
 * run ended. A statement no reading claims (asserted by hand) is still a row: it names no reading.
 */
export async function statementsWith(store: TStatementStore, predicate: string): Promise<TStatementRow[]> {
	const quads = (await store.query({ predicate })) as TEdgeQuad[];
	const readings = await readingsByStatement(store);
	const rows: TStatementRow[] = [];
	for (const quad of quads) {
		const objectType = quad.objectType;
		// A quad with no target type is a literal property, not a statement about another individual.
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
			const reading = await store.getIndividual<{ seqPath?: string }>(READING_LABEL, readingId);
			const seqPathId = reading?.seqPath;
			if (seqPathId) {
				const run = await runOf(store, seqPathId);
				row.assertedBy = { "@id": String(run?.[SEQ_PATH_FIELD.id] ?? seqPathId), "@type": SEQ_PATH_LABEL };
				if (run?.[SEQ_PATH_FIELD.actionStatus]) row.outcome = String(run[SEQ_PATH_FIELD.actionStatus]);
			}
		}
		rows.push(row);
	}
	return rows;
}

/** Every rel a statement was made with, so a reader picks one rather than guessing. Derived from what the store holds, not from a list. */
export function statementPredicates(): string[] {
	return Object.values(LinkRelations)
		.filter((entry) => entry.range === "iri" && !(entry as { abstract?: boolean }).abstract)
		.map((entry) => entry.rel);
}
