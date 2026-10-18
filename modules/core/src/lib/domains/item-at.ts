/** The item at `index` of a list the caller reads within its bounds: an index outside them is a fault, so it throws. */
export function itemAt<T>(list: ArrayLike<T>, index: number): T {
	if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new RangeError(`index ${index} is outside a list of ${list.length}`);
	return list[index] as T;
}

/** The value `map` holds for a key the caller reads among the map's keys: an absent key is a fault, so it throws and names `what`. */
export function valueAt<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
	if (!map.has(key)) throw new RangeError(`${what}: the map lacks ${String(key)}`);
	return map.get(key) as V;
}
