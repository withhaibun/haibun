/**
 * A record as the quads that state it, which the device holds.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";

/** One individual as the quads that state it. Exported so what a page holds a window of records by is one write of the
 *  same quads a single upsert would have written. A record's identity is the id its served `@id` states, read back through
 *  recordOfIri, else the `id` it states: the page holds what a site serves and what a site records, and both are one record.
 *  The served `@id` is held with the record, and a read states it again; the page doesn't derive an `@id`. */
export function individualAsQuads(label: string, individual: Record<string, unknown>): [string, TQuad[]] {
	const named = recordOfIri(individual["@id"]);
	const id = named === undefined ? individual.id : named.id;
	if (typeof id !== "string") throw new Error(`this individual doesn't state an identity to hold it by (got ${JSON.stringify(individual["@id"] ?? individual.id)}).`);
	const quads = Object.entries(individual).map(([predicate, object]) => ({ subject: id, predicate, object, namedGraph: label, timestamp: Date.now() }));
	return [id, quads];
}

/** Returns the key a subject's level is held under: its type and its id. */
export const subjectKey = (quad: TQuad): string => `${quad.namedGraph}\0${quad.subject}`;

/** Returns each subject's access level, read in one pass over the quads that describe it: the level a record a site served
 *  states as its field, else the level of the quads a store wrote. */
export function levelsOf(quads: Iterable<TQuad>): Map<string, unknown> {
	const levels = new Map<string, unknown>();
	for (const quad of quads) {
		const key = subjectKey(quad);
		if (quad.predicate === LinkRelations.ACCESS_LEVEL.rel) levels.set(key, quad.object);
		else if (levels.get(key) === undefined) levels.set(key, quad.accessLevel);
	}
	return levels;
}
