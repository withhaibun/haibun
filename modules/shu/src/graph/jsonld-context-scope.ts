/**
 * Narrow a served JSON-LD context to one type: the prefixes a context node references, so the context view for a
 * type carries only its own vocabulary, not the whole store's (a credential does not use sosa/foaf/otel/wallet/…).
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
			for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
				addCurie(k);
				scan(val);
			}
	};
	scan(node);
	return used;
}
