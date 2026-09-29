/** Split a term like "result.total" into baseName and path segments. */
export function parseDotPath(term: string): { baseName: string; pathSegments: string[] } {
	const idx = term.indexOf(".");
	if (idx === -1) return { baseName: term, pathSegments: [] };
	return { baseName: term.slice(0, idx), pathSegments: term.slice(idx + 1).split(".") };
}

/** Where a dot path stopped: the segments it read, the one the value there doesn't have, and the fields that value has. */
type TDotPathMiss = { at: string[]; missing: string; has: string[] };

/** Navigate into a runtime value using path segments. A path that names a field the value doesn't have states where it
 *  stopped. */
export function navigateValue(value: unknown, segments: string[]): { value: unknown; found: true } | { value: undefined; found: false; miss: TDotPathMiss } {
	let current = value;
	for (const [i, seg] of segments.entries()) {
		const fields = current !== null && typeof current === "object" ? current : undefined;
		if (!fields || !(seg in fields)) return { value: undefined, found: false, miss: { at: segments.slice(0, i), missing: seg, has: fields ? Object.keys(fields) : [] } };
		current = Reflect.get(fields, seg);
	}
	return { value: current, found: true };
}
