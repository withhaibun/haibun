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
 *  record it reaches (`{ "@id" }`, with its `@type` where the edge reaches several types), and an edge the type declares `owns`
 *  holds the node of each record it owns. */
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

/** What `remove` removes: the record a name names with what it owns, or its edge of a relation to the record `to` names, which
 *  keeps both records. */
export type TRemoval = TRecordName & { readonly edge?: { readonly rel: string; readonly to: string } };

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
	/** Removes what `removal` names: a record with what it owns, or one of its edges. */
	remove(removal: TRemoval): Promise<void>;
};

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
