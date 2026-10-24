/**
 * A derivation held for the entries of its source. A source such as the registered domains or the loaded steppers
 * changes in place: a feature declares a domain, and a waypoint adds a step. The held value is derived again where the
 * source holds an entry other than the one it held at the last derivation, so a change never reads a value derived from
 * an earlier set of entries, and an unchanged source reads the held value.
 */

/** Whether two lists hold the same entries in the same order, each compared by identity. */
export const sameEntries = (held: readonly unknown[], now: readonly unknown[]): boolean => held.length === now.length && held.every((entry, at) => entry === now[at]);

/**
 * Returns `derive` held per source. `entriesOf` lists the entries of a source that the derivation reads, each compared by
 * identity, so the derivation runs again only where an entry is added, removed or replaced.
 */
export function heldPerEntries<S extends object, T>(entriesOf: (source: S) => readonly unknown[], derive: (source: S) => T): (source: S) => T {
	const held = new WeakMap<S, { entries: readonly unknown[]; value: T }>();
	return (source: S): T => {
		// A copy, since a source such as a list of steppers can return itself as its entries and then change in place.
		const entries = [...entriesOf(source)];
		const last = held.get(source);
		if (last !== undefined && sameEntries(last.entries, entries)) return last.value;
		const value = derive(source);
		held.set(source, { entries, value });
		return value;
	};
}

/** The keys and values of a record, as the entries a derivation over the record reads. */
export const recordEntries = (record: Readonly<Record<string, unknown>>): readonly unknown[] => Object.entries(record).flat();
