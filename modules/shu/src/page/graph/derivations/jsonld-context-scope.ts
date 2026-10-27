/**
 * Narrow a served JSON-LD context to one type: the prefixes a context node references, so the context view for a
 * type carries only its own vocabulary, not the whole store's (a resource does not use sosa/foaf/otel/wallet/…).
 */

/** The CURIE prefixes a JSON-LD context node references, in its term @ids (and any CURIE-valued key it carries),
 *  skipping JSON-LD keywords (@…) and absolute IRIs (http(s):/urn:). */
export function prefixesReferencedBy(node: unknown): Set<string> {
	const used = new Set<string>();
	const addCurie = (s: string): void => {
		const i = s.indexOf(":");
		if (i > 0 && !s.startsWith("@") && !/^(https?|urn):/.test(s)) used.add(s.slice(0, i));
	};
	const scan = (v: unknown): void => {
		if (typeof v === "string") addCurie(v);
		else if (Array.isArray(v)) v.forEach(scan);
		else if (v && typeof v === "object")
			for (const [k, val] of Object.entries(v)) {
				addCurie(k);
				scan(val);
			}
	};
	scan(node);
	return used;
}

/** A served context narrowed to one type: the type's node and only the prefixes its own terms reference, with the
 *  context's version, so the context of one type reads without the whole store's vocabulary. */
export function typeContext(context: Record<string, unknown>, type: string): Record<string, unknown> {
	const node = context[type];
	const used = prefixesReferencedBy(node);
	const prefixes = Object.fromEntries(Object.entries(context).filter(([k, v]) => (typeof v === "string" && used.has(k)) || k === "@version"));
	return node === undefined ? prefixes : { ...prefixes, [type]: node };
}
