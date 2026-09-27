/** The item at `index` of a list the caller reads within its bounds: an index outside them is a fault, so it throws. */
export function itemAt<T>(list: ArrayLike<T>, index: number): T {
	if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new RangeError(`index ${index} is outside a list of ${list.length}`);
	return list[index] as T;
}
