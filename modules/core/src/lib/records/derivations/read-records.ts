/**
 * Derives a read of records from the declarations of their types: the page's bound, the count's ceiling, the refusal of a
 * read the store doesn't reach, the page's order and the page of a set of held records. Every store reads by these rules,
 * so a page holds the same records in the same order whichever store returns it.
 */
import {
	COUNT_CEILING,
	REACHED_BY,
	countedTo,
	pageLimit,
	pointsThrough,
	querySurface,
	reachedBy,
	titledByOf,
	type TConcernCatalog,
	type TCounted,
	type TQuerySurface,
	type TTitledBy,
} from "../../hypermedia.js";
import {
	ORDER_KEY,
	VIA_FIELD,
	statedQuery,
	type TDistinctValues,
	type TGraphQuery,
	type TOrderKey,
	type TQuad,
	type TRecordsPage,
	type TSearchCondition,
	type TStatedQuery,
} from "../../steps/domains/quad-types.js";
import { AccessQuery, LinkRelations, isPersisted, statedLevel, type THeldBy, type TRegisteredDomain } from "../../resources.js";
import { itemAt } from "../../util/item-at.js";

/** The name a refusal and a rejected bound state for the read function. */
export const READ_RECORDS = "readRecords";

/** What a read of one type reads from its declaration: the field that holds a record's id, the fields and relations a read
 *  reaches, the field a page orders by where the read doesn't name a sort, where core holds the type's records, and the
 *  property or edge that titles a record. */
export type TReadDeclaration = { id: string; surface: TQuerySurface; defaultSort: string; heldBy?: THeldBy; title?: TTitledBy };

/** The declared types a store holds, the relations they declare, and each type's declaration. */
export type TReadDeclarations = { types: readonly string[]; relations: readonly string[]; of(label: string): TReadDeclaration | undefined };

/** What a store reads: whether it searches text, the types it holds and the relations it holds. */
export type TReadReach = { search: boolean; types: readonly string[]; relations: readonly string[] };

/** A page of the records from an offset, or the first records of each type. */
export type TReadPage = { limit: number; offset: number } | { perType: number };

const unique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** The read declarations derived from a set of domains, and the count of those domains. */
const declarationsFor = new WeakMap<Record<string, TRegisteredDomain>, { size: number; declarations: TReadDeclarations }>();

/** Returns the read declarations of the persisted types among `domains`. A type's declaration is derived once, where a read
 *  first names it, and the declarations are derived again where a domain was registered since. */
export function readDeclarationsOf(domains: Record<string, TRegisteredDomain>): TReadDeclarations {
	const size = Object.keys(domains).length;
	const held = declarationsFor.get(domains);
	if (held?.size === size) return held.declarations;
	const persisted = Object.values(domains).flatMap(({ schema, topology }) => (isPersisted(topology) ? [{ schema, topology }] : []));
	const derived = new Map<string, TReadDeclaration | undefined>();
	const declarationOf = (label: string): TReadDeclaration | undefined => {
		const domain = persisted.find(({ topology }) => topology.persistedAs === label);
		if (!domain) return undefined;
		const { id, defaultSort, heldBy } = domain.topology;
		const title = titledByOf(domain.topology);
		return { id, surface: querySurface(domain), defaultSort: defaultSort ?? LinkRelations.GENERATED_AT_TIME.rel, ...(heldBy ? { heldBy } : {}), ...(title ? { title } : {}) };
	};
	const declarations: TReadDeclarations = {
		types: unique(persisted.map(({ topology }) => topology.persistedAs)),
		relations: unique(persisted.flatMap(({ topology }) => (topology.edges === undefined ? [] : Object.keys(topology.edges)))),
		of(label) {
			if (!derived.has(label)) derived.set(label, declarationOf(label));
			return derived.get(label);
		},
	};
	declarationsFor.set(domains, { size, declarations });
	return declarations;
}

/** Returns the read declarations of the types a concern catalog lists. The catalog doesn't list the fields a search reads, and
 *  a store that reads by these declarations doesn't search. */
export function readDeclarationsOfCatalog(catalog: TConcernCatalog): TReadDeclarations {
	const concerns = Object.values(catalog.persisted);
	return {
		types: unique(concerns.map(({ label }) => label)),
		relations: unique(concerns.flatMap(({ edges }) => Object.keys(edges))),
		of(label) {
			const concern = catalog.persisted[label];
			if (!concern) return undefined;
			const properties = Object.fromEntries(concern.queryable.map((field) => [field, [REACHED_BY.filter]]));
			const references = Object.fromEntries(Object.entries(concern.edges).map(([relation, edge]) => [relation, edge.targets]));
			return { id: concern.idField, surface: { label, properties, references }, defaultSort: concern.validTimeField };
		},
	};
}

/** Returns the page a read states. Throws where `limit` or `perType` is outside 1 to `MAX_PAGE_ROWS`. */
export function readPage({ limit, offset, perType }: Pick<TStatedQuery, "limit" | "offset" | "perType">): TReadPage {
	return perType === undefined ? { limit: pageLimit(READ_RECORDS, limit), offset } : { perType: pageLimit(READ_RECORDS, perType) };
}

/** Returns the ceiling of a read's count. Throws where `countTo` is outside 1 to `COUNT_CEILING`. */
export function countCeiling({ countTo }: Pick<TGraphQuery, "countTo">): number {
	if (countTo === undefined) return COUNT_CEILING;
	if (!Number.isInteger(countTo) || countTo < 1 || countTo > COUNT_CEILING)
		throw new Error(`${READ_RECORDS} rejects a count ceiling of ${countTo}: a count stops at 1 to ${COUNT_CEILING} records`);
	return countTo;
}

/** Returns the count of `matched` records against the read's ceiling. */
export const heldCount = (matched: number, ceiling: number): TCounted => countedTo(Math.min(matched, ceiling), ceiling);

/** Returns the distinct values of `values` in order, the first `COUNT_CEILING` of them, with their count to the ceiling. */
export function distinctOf(values: Iterable<string>): TDistinctValues {
	const distinct = [...new Set(values)].sort().slice(0, COUNT_CEILING);
	return { values: distinct, ...countedTo(distinct.length, COUNT_CEILING) };
}

/** Returns the count of a read with `skipCount`: the records a page returned, against the page's size. */
export const skippedCount = (returned: number, page: TReadPage): TCounted => countedTo(returned, "perType" in page ? page.perType : page.limit);

/** Returns the text that refuses a filter or a sort on fields a type doesn't compare. It names the compared fields, and the
 *  named fields a search reads. */
export function undeclaredRefusal(read: string, label: string, undeclared: readonly string[], compared: readonly string[], searched: readonly string[]): string {
	const bySearch = undeclared.filter((field) => searched.includes(field));
	const searchNote = bySearch.length > 0 ? ` ${bySearch.join(", ")} ${bySearch.length === 1 ? "is" : "are"} indexed for text search: use a textQuery with the words you need.` : "";
	return `${read}(${label}) doesn't compare ${undeclared.join(", ")}. It compares ${compared.join(", ")}.${searchNote}`;
}

/** Returns the routes that reach a type's records without a search: its compared fields, its relations and its id field. */
function routesOf(surface: TQuerySurface, id: string): string {
	const compared = reachedBy(surface, REACHED_BY.filter);
	const pointing = pointsThrough(surface);
	return `${compared.length > 0 ? `Compared by a filter: ${compared.join(", ")}.` : "A filter doesn't compare a field of it."} ${pointing.length > 0 ? `A filter names by its id the record at the other end of: ${pointing.join(", ")}.` : "A filter doesn't name a record at the other end of it by id."} Addressed by: ${id}.`;
}

/** Returns the text that refuses a term on a type whose fields a search doesn't read, with the routes that reach the type. */
export function unsearchedRefusal(read: string, label: string, surface: TQuerySurface, id: string): string {
	return `${read}(${label}): a search doesn't read a field of this type. ${routesOf(surface, id)}`;
}

/** Returns the text that refuses a term in a store that doesn't search text, with the routes that reach the type. */
function unsearchingRefusal(label: string | undefined, declared: TReadDeclaration | undefined): string {
	const routes =
		label !== undefined && declared ? routesOf(declared.surface, declared.id) : "It reads a type by its filters, named records, and the records that reference a record.";
	return `${READ_RECORDS}(${label ?? "every type"}): this store doesn't search text. ${routes}`;
}

/** Returns the text that refuses relations the store doesn't hold, with the relations it holds. */
export function unheldRelationRefusal(unheld: readonly string[], held: readonly string[]): string {
	const holds = held.length > 0 ? `The relations it holds: ${[...held].sort().join(", ")}` : "It doesn't hold a relation.";
	return `a relation named ${unheld.map((relation) => `"${relation}"`).join(", ")} doesn't reach a record in this graph. ${holds}`;
}

/** Returns the text that refuses a comparison other than `eq` or `in` on a relation. */
export const relationOperatorRefusal = (label: string, relation: string, operator: string): string =>
	`${label}.${relation} is a relation: a filter names the record at its other end with eq or in, not ${operator}`;

const NOTHING_NAMED = `${READ_RECORDS} reads one type, a term across the types a search reads, the records that reference a record or that a record references, or named records: name a label, a textQuery, references, referencedBy or named`;

/**
 * Returns the text of the refusal of a read the store doesn't reach, or undefined where the store reaches it. A store
 * rejects such a read with this text, so a reader is refused alike by every store, and the text names the routes that do
 * reach the records.
 */
export function readRefusal(query: TGraphQuery, declarations: Pick<TReadDeclarations, "of">, reach: TReadReach): string | undefined {
	const { label, textQuery, references, referencedBy, named, filters, sortBy } = statedQuery(query);
	if (label === undefined && textQuery === undefined && !references && !referencedBy && !named) return NOTHING_NAMED;
	if (named && label === undefined) return `${READ_RECORDS} reads the named records of one type: name their type in label`;
	const unheld = [...(references?.via ?? []), ...(referencedBy?.via ?? [])].filter((relation) => !reach.relations.includes(relation));
	if (unheld.length > 0) return unheldRelationRefusal(unheld, reach.relations);
	if (label === undefined) {
		if (filters.length > 0 || sortBy !== undefined) return `${READ_RECORDS} compares a filter and a sort against one type's properties: name the type of the records in label`;
		return textQuery !== undefined && !reach.search ? unsearchingRefusal(undefined, undefined) : undefined;
	}
	const notHeld = `${READ_RECORDS} reads a type this store holds, and ${label} isn't one of them. It holds ${[...reach.types].sort().join(", ")}`;
	if (!reach.types.includes(label)) return notHeld;
	const declared = declarations.of(label);
	if (!declared) return notHeld;
	const { surface } = declared;
	const compared = reachedBy(surface, REACHED_BY.filter);
	const relations = Object.keys(surface.references);
	const searched = reach.search ? reachedBy(surface, REACHED_BY.search) : [];
	const filterable = [...compared, ...relations];
	const undeclared = unique(filters.map(({ predicate }) => predicate).filter((field) => !filterable.includes(field)));
	if (undeclared.length > 0) return undeclaredRefusal(READ_RECORDS, label, undeclared, filterable, searched);
	if (sortBy !== undefined && !compared.includes(sortBy)) return undeclaredRefusal(READ_RECORDS, label, [sortBy], compared, searched);
	const comparedRelation = filters.find(({ predicate, operator }) => relations.includes(predicate) && operator !== "eq" && operator !== "in");
	if (comparedRelation) return relationOperatorRefusal(label, comparedRelation.predicate, comparedRelation.operator);
	if (textQuery === undefined) return undefined;
	if (!reach.search) return unsearchingRefusal(label, declared);
	return reachedBy(surface, REACHED_BY.search).length > 0 ? undefined : unsearchedRefusal(READ_RECORDS, label, surface, declared.id);
}

/** Returns true where a record held at `level` is on a page read at `asked`. A read at `all`, or a read that doesn't state
 *  a level, reads every level. A read at one level refuses a record that doesn't state its level (`statedLevel`). */
export function readsAtLevel(level: unknown, asked: TGraphQuery["accessLevel"]): boolean {
	if (asked === undefined || asked === AccessQuery.all) return true;
	return statedLevel(level) === asked;
}

const ID_ASCENDING: TOrderKey = { key: ORDER_KEY.id, order: "asc" };
const TYPE_ASCENDING: TOrderKey = { key: ORDER_KEY.type, order: "asc" };
const SCORE_ASCENDING: TOrderKey = { key: ORDER_KEY.score, order: "asc" };

/**
 * Returns the keys that order a read's page. The last key is the record's `@id`, so each record holds one position. A named
 * read orders by the order of `named`. A term orders by type and score, and a reference read by type, and then by score
 * where a term narrows it. A page of one type orders by its sort field, or by `defaultSort`, with ties in the same direction.
 */
export function readOrder(query: Pick<TStatedQuery, "named" | "references" | "referencedBy" | "textQuery" | "sortBy" | "sortOrder">, defaultSort: string | undefined): TOrderKey[] {
	if (query.named) return [{ key: ORDER_KEY.named, order: "asc" }, ID_ASCENDING];
	if (query.textQuery !== undefined) return [TYPE_ASCENDING, SCORE_ASCENDING, ID_ASCENDING];
	if (query.references || query.referencedBy) return [TYPE_ASCENDING, ID_ASCENDING];
	const key = query.sortBy ?? defaultSort;
	if (key === undefined) throw new Error(`${READ_RECORDS} orders a page of one type by a sort field, and this read doesn't name one or a type's default sort`);
	return [
		{ key, order: query.sortOrder },
		{ key: ORDER_KEY.id, order: query.sortOrder },
	];
}

/** Compares two held values. Numbers compare as numbers where both are numbers, and other values compare as text, which
 *  orders an ISO instant by time. A value a record doesn't hold sorts before one it holds. */
export function compareHeld(a: unknown, b: unknown): number {
	if (a === undefined || a === null) return b === undefined || b === null ? 0 : -1;
	if (b === undefined || b === null) return 1;
	if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
	const [x, y] = [String(a), String(b)];
	return x < y ? -1 : x > y ? 1 : 0;
}

/** Returns true where a held value satisfies one condition. Numbers compare as numbers where both sides are numbers, and other
 *  values compare as text, which orders an ISO instant by time. A value the record doesn't hold doesn't satisfy a condition. */
export function satisfies(held: unknown, condition: TSearchCondition): boolean {
	if (held === undefined || held === null) return false;
	const order = (against: string): number => {
		const a = typeof held === "number" ? held : Number(held);
		const b = Number(against);
		if (!Number.isNaN(a) && !Number.isNaN(b) && typeof held !== "string") return a < b ? -1 : a > b ? 1 : 0;
		const text = String(held);
		return text < against ? -1 : text > against ? 1 : 0;
	};
	switch (condition.operator) {
		case "eq":
			return String(held) === condition.value;
		case "in":
			return (condition.values ?? [condition.value]).includes(String(held));
		case "contains":
			return String(held).includes(condition.value);
		case "gt":
			return order(condition.value) > 0;
		case "gte":
			return order(condition.value) >= 0;
		case "lt":
			return order(condition.value) < 0;
		case "lte":
			return order(condition.value) <= 0;
		case "between":
			if (condition.value2 === undefined) throw new Error(`a "between" condition on ${condition.predicate} names only one bound`);
			return order(condition.value) >= 0 && order(condition.value2) <= 0;
		default:
			throw new Error(`a store of quads doesn't compare by the "${condition.operator}" condition on ${condition.predicate}`);
	}
}

/** One edge of a held record: its relation, and the type and id of the record at its other end. */
export type THeldEdge = { rel: string; label: string; id: string };

/** A record as a store of quads holds it: its id, its type, its fields, its edges and its level. */
export type THeldRecord = { id: string; label: string; fields: Record<string, unknown>; edges: THeldEdge[]; level: unknown };

/** Returns the records a set of quads describes, in the order their subjects first appear. A quad that states the type of its
 *  object is an edge. A record's level is its `accessLevel` field, or else the level of its quads. */
export function recordsOfQuads(quads: readonly TQuad[]): THeldRecord[] {
	const held = new Map<string, THeldRecord>();
	for (const quad of quads) {
		const key = `${quad.namedGraph}\u0000${quad.subject}`;
		let record = held.get(key);
		if (!record) {
			record = { id: quad.subject, label: quad.namedGraph, fields: {}, edges: [], level: quad.accessLevel };
			held.set(key, record);
		}
		if (quad.objectType) record.edges.push({ rel: quad.predicate, label: quad.objectType, id: String(quad.object) });
		else record.fields[quad.predicate] = quad.object;
	}
	return [...held.values()].map((record) => ({ ...record, level: record.fields[LinkRelations.ACCESS_LEVEL.rel] ?? record.level }));
}

/** A record a read reached, with the relations that reached it on a reference read. */
type TReached = { record: THeldRecord; via?: string[] };

const keyOf = (label: string, id: string): string => `${label}\u0000${id}`;

/** Returns the relations of `edges` that end at `label` `id`, through the relations `via` names or every relation. */
const relationsTo = (edges: readonly THeldEdge[], label: string, id: string, via: readonly string[] | undefined): string[] =>
	unique(edges.filter((edge) => edge.label === label && edge.id === id && (!via || via.includes(edge.rel))).map(({ rel }) => rel));

/** Returns the records a read names before its narrowing: its named records in order, the records that reference a record or
 *  that a record references, or the records of its type. */
function reached(records: readonly THeldRecord[], query: TGraphQuery): TReached[] {
	const byKey = new Map(records.map((record) => [keyOf(record.label, record.id), record]));
	const { label, named, references, referencedBy } = query;
	if (named && label !== undefined) return named.flatMap((id) => [byKey.get(keyOf(label, id))].flatMap((record) => (record ? [{ record }] : [])));
	if (references)
		return records.flatMap((record) => {
			const via = relationsTo(record.edges, references.label, references.id, references.via);
			return via.length > 0 ? [{ record, via }] : [];
		});
	if (referencedBy) {
		const source = byKey.get(keyOf(referencedBy.label, referencedBy.id));
		if (!source) return [];
		const reached = source.edges.flatMap((edge) => {
			const target = byKey.get(keyOf(edge.label, edge.id));
			return !target || (referencedBy.via && !referencedBy.via.includes(edge.rel)) ? [] : [{ edge, target }];
		});
		return [...Map.groupBy(reached, ({ edge }) => keyOf(edge.label, edge.id))].map(([, held]) => ({
			record: itemAt(held, 0).target,
			via: unique(held.map(({ edge }) => edge.rel)),
		}));
	}
	return records.filter((record) => record.label === label).map((record) => ({ record }));
}

/** Returns true where a record satisfies a filter: a field by its value, a relation by the id at its other end. */
function filtered(record: THeldRecord, filter: TSearchCondition, relations: readonly string[]): boolean {
	if (!relations.includes(filter.predicate)) return satisfies(record.fields[filter.predicate], filter);
	const ids = filter.operator === "in" ? (filter.values ?? [filter.value]) : [filter.value];
	return record.edges.some((edge) => edge.rel === filter.predicate && ids.includes(edge.id));
}

/** Returns a comparison of two items by `keys`, each compared by `compareHeld` in its key's direction. `keyValue` returns an
 *  item's value of one key. */
export function compareByOrder<T>(keys: readonly TOrderKey[], keyValue: (key: string, item: T) => unknown): (a: T, b: T) => number {
	return (a, b) => {
		for (const { key, order } of keys) {
			const compared = compareHeld(keyValue(key, a), keyValue(key, b));
			if (compared !== 0) return order === "asc" ? compared : -compared;
		}
		return 0;
	};
}

/** Returns a comparison of two reached records by the read's order keys. */
const byOrder = (keys: readonly TOrderKey[]): ((a: TReached, b: TReached) => number) =>
	compareByOrder<TReached>(keys, (key, { record }) => (key === ORDER_KEY.id ? record.id : key === ORDER_KEY.type ? record.label : record.fields[key]));

/**
 * Returns a page of the records a set of held records holds for a read. The in-memory store and the device store read
 * through this derivation, so their pages hold the same records in the same order. Throws the text of `readRefusal` for a
 * read the declarations don't reach, and a store of held records doesn't search text.
 */
export function readFromRecords(records: readonly THeldRecord[], read: TGraphQuery, declarations: TReadDeclarations): TRecordsPage {
	const query = statedQuery(read);
	const refusal = readRefusal(query, declarations, { search: false, types: declarations.types, relations: declarations.relations });
	if (refusal) throw new Error(refusal);
	const page = readPage(query);
	const ceiling = countCeiling(query);
	const declared = query.label === undefined ? undefined : declarations.of(query.label);
	const relations = declared?.surface.references === undefined ? [] : Object.keys(declared?.surface.references);
	const order = readOrder(query, declared?.defaultSort);
	const narrowed = reached(records, query).filter(
		({ record }) =>
			(query.label === undefined || record.label === query.label) &&
			query.filters.every((filter) => filtered(record, filter, relations)) &&
			readsAtLevel(record.level, query.accessLevel),
	);
	const matched = query.named ? narrowed : narrowed.sort(byOrder(order));
	const vertexOf = ({ record, via }: TReached): Record<string, unknown> => ({ ...record.fields, "@id": record.id, "@type": record.label, ...(via ? { [VIA_FIELD]: via } : {}) });
	if ("perType" in page) {
		const byType = Map.groupBy(matched, (one) => one.record.label);
		const kept = [...byType.values()].flatMap((ofType) => ofType.slice(0, page.perType));
		const perType = Object.fromEntries(
			[...byType].map(([type, ofType]) => [type, query.skipCount ? skippedCount(Math.min(ofType.length, page.perType), page) : heldCount(ofType.length, ceiling)]),
		);
		return { vertices: kept.map(vertexOf), ...(query.skipCount ? skippedCount(kept.length, page) : heldCount(matched.length, ceiling)), order, perType };
	}
	const vertices = matched.slice(page.offset, page.offset + page.limit).map(vertexOf);
	return { vertices, ...(query.skipCount ? skippedCount(vertices.length, page) : heldCount(matched.length, ceiling)), order };
}
