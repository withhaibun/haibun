/**
 * Declares what a caller writes and removes. A caller states a record as one JSON-LD node: `@type` names the record's type, a
 * key names a field of the type or an edge its topology declares, and an edge the type declares `owns` holds the node of each
 * record it owns, embedded, so a node states a record with what it owns, transitively. A store derives the unit's parts from the
 * type declarations, and writes the unit through one of three verbs, whole or not at all: `create` refuses a record the store
 * holds, `update` refuses a record that changed since the version its caller read, and `merge` applies the node's fields without
 * depending on a read. `remove` removes a record with what it owns.
 */

/** The JSON-LD keywords a node states: the type of its record, and the id of a record a reference names. */
export const NODE_KEY = { type: "@type", id: "@id" } as const;

/** A record as a caller states it: one JSON-LD node. A field holds its value, and a null removes the field; a field that holds the
 *  id of a record an edge field of the type's schema reaches is written as that edge as well. An edge holds a reference to each
 *  record it reaches, whose `@id` is the record's typed CURIE (`referenceTo`), and an edge the type declares `owns` holds the node
 *  of each record it owns. */
export type TNode = { readonly [NODE_KEY.type]: string; readonly [key: string]: unknown };

/** The verbs that write a node to a store. */
export const WRITE_VERB = { create: "create", update: "update", merge: "merge" } as const;
export type TWriteVerb = (typeof WRITE_VERB)[keyof typeof WRITE_VERB];

/** The version of a record that a caller read: the version a store returned for it, or null where the store didn't hold it. */
export type TReadVersion = string | null;

/** A record a caller read with its version, which an update of the record states. */
export type TVersionedRead<T> = { readonly record: T | undefined; readonly version: TReadVersion };

/** A record by its type and its id. */
export type TRecordName = { readonly label: string; readonly id: string };

/** A typed CURIE: a type's label, a colon and a record's id, which isn't an absolute IRI's `//`. The prefix carries the record's
 *  type, so one IRI names a record's type and its id. */
const TYPED_CURIE = /^([A-Za-z][\w-]*):(?!\/\/)(.+)$/s;

/** Returns the typed CURIE that names a record. */
export const curieOf = ({ label, id }: TRecordName): string => `${label}:${id}`;

/** Returns the record a typed CURIE names, or undefined where the value isn't a typed CURIE. */
export function recordOfCurie(curie: unknown): TRecordName | undefined {
	const named = typeof curie === "string" ? TYPED_CURIE.exec(curie) : null;
	return named?.[1] === undefined || named[2] === undefined ? undefined : { label: named[1], id: named[2] };
}

/** A reference to a record, as an edge of a node holds it: a node that states only its target's typed CURIE. */
export type TReference = { readonly [NODE_KEY.id]: string };

/** Returns the reference to the `label` record `id`. */
export const referenceTo = (label: string, id: string): TReference => ({ [NODE_KEY.id]: curieOf({ label, id }) });

/** What `remove` removes: the record a name names with what it owns, or its edge of a relation to the record `to` names, which
 *  keeps both records. */
export type TRemoval = TRecordName & { readonly edge?: { readonly rel: string; readonly to: TRecordName } };

/** The writes a store makes through its verbs. A write without a verb doesn't type-check, so each write states whether it creates
 *  a record, updates the version it read, or merges fields into what the store holds. */
export type TWritePort = {
	/** Writes a record the store doesn't hold, with what it owns, and returns its id. Refuses a record the store holds. */
	create(node: TNode): Promise<string>;
	/** Writes the node's fields into the record its caller read at `version`, and returns its id. Refuses a record that changed
	 *  since that read. */
	update(node: TNode, version: TReadVersion): Promise<string>;
	/** Writes the node's fields into what the store holds of the record, or writes the record where it doesn't hold it, and
	 *  returns its id. */
	merge(node: TNode): Promise<string>;
	/** Writes each unit through its verb, and returns how each ended in their order. A unit the store refuses, or whose write
	 *  fails, isn't written, and the other units are written. A store with transactions writes the units in one. */
	writeMany(units: readonly TUnitWrite[]): Promise<TUnitWritten[]>;
	/** Removes what `removal` names: a record with what it owns, or one of its edges. */
	remove(removal: TRemoval): Promise<void>;
	/** Removes what each removal names, and returns how each ended in their order. A removal the store refuses, or that fails,
	 *  isn't made, and the others are. A store with transactions makes the removals in one. */
	removeMany(removals: readonly TRemoval[]): Promise<TUnitRemoved[]>;
};

/** How one removal of a batch ended: made, or why the store didn't make it. */
export type TUnitRemoved = { removed: TRecordName } | { refused: string };

/** One unit a batch writes: its verb and its node, and for an update the version its caller read. */
export type TUnitWrite = { verb: typeof WRITE_VERB.create | typeof WRITE_VERB.merge; node: TNode } | { verb: typeof WRITE_VERB.update; node: TNode; version: TReadVersion };

/** How one unit of a batch ended: the id of its record, or why the store didn't write it. */
export type TUnitWritten = { id: string } | { refused: string };

/** Returns the version a write states, and the version the store holds, as a refusal names them. */
const statedText = (version: TReadVersion): string => (version === null ? "that the store didn't hold the record" : `version ${version}`);
const heldText = (version: TReadVersion): string => (version === null ? "the store doesn't hold it" : `the store holds version ${version}`);

/** The refusal of a unit whose record changed since its caller read it, or of a `create` of a record the store holds. The caller
 *  reads the record again and writes from what the store holds. */
export class ChangedSinceRead extends Error {
	constructor(
		readonly record: TRecordName,
		readonly read: TReadVersion,
		readonly held: TReadVersion,
	) {
		super(
			`${record.label} "${record.id}" changed since it was read: the write states ${statedText(read)}, and ${heldText(held)}. Read the record again and write from what the store holds`,
		);
	}
}

/** Returns the version a verb states of its record's read: null for `create`, the read version for `update`, and undefined for
 *  `merge`, which doesn't depend on a read. */
export const statedVersion = (verb: TWriteVerb, version: TReadVersion | undefined): TReadVersion | undefined =>
	verb === WRITE_VERB.create ? null : verb === WRITE_VERB.update ? version : undefined;

/** Refuses the unit whose record `record` names where the version its verb states isn't the version the store holds. */
export function assertReadVersion(record: TRecordName, read: TReadVersion | undefined, held: TReadVersion): void {
	if (read !== undefined && read !== held) throw new ChangedSinceRead(record, read, held);
}

/** The refusal of a unit that writes outside the contract of the step in progress. */
export class WriteOutsideContract extends Error {
	constructor(
		readonly step: string,
		readonly outside: readonly string[],
	) {
		super(
			`${step} writes ${outside.join(", ")}, which its contract's products and changes don't list, so the store doesn't write the unit. List each field in the step's contract's changes, or write it from a step whose contract lists it`,
		);
	}
}

/** The refusal of a unit that gives its record the values of a set of properties its type declares unique, which another record
 *  of the type holds. The caller writes the record with other values. */
export class NotUnique extends Error {
	constructor(
		readonly record: TRecordName,
		readonly values: Readonly<Record<string, unknown>>,
	) {
		const stated = Object.entries(values).map(([field, value]) => `${field} ${JSON.stringify(value)}`);
		super(
			`${record.label} "${record.id}" isn't written: another ${record.label} holds ${stated.join(" and ")}, which its type declares unique. Write the record with other values`,
		);
	}
}

/** Returns the values a record holds of a set of fields, or undefined where it doesn't state every field of the set. */
export function uniqueValuesOf(fields: readonly string[], held: (field: string) => unknown): Record<string, unknown> | undefined {
	const values = fields.map((field) => [field, held(field)] as const);
	return values.every(([, value]) => value !== undefined && value !== null) ? Object.fromEntries(values) : undefined;
}
