/**
 * Resolve the property vocabulary a type conforms to but does not itself model: the terms a standards-conforming
 * instance MAY carry beyond the fields haibun's topology declares. There is ONE source of a type's vocabulary: its
 * assembled JSON-LD @context (produced by getJsonLdContext: the single topology→context bridge). This module CONSUMES
 * that context with the jsonld processor (the single resolver): it reads the type's declared field names from the scoped
 * context and resolves each referenced standardContext's type-scoped terms to genuine IRIs, returning the terms the
 * standard declares that the type does NOT model (deduped by name against the type's own fields). No hand-rolled context
 * walking, no IRI-local-name matching, jsonld handles prefix expansion, keyword aliases, and string/array contexts, so a
 * context shape this code cannot resolve yields no terms rather than fabricating any.
 *
 * Server-side only (Node): a consumer registers the context documents + a resolver into core's loader; this reads
 * whatever a type declares, naming no consumer vocabulary.
 */
import { jsonld as jsonldRaw, documentLoader } from "@haibun/core/lib/jsonld-loader.js";
import { getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import { isPersisted, type TRegisteredDomain } from "@haibun/core/lib/resources.js";

const jsonld = jsonldRaw as unknown as {
	processContext: (active: unknown, localCtx: unknown, opts?: unknown) => Promise<{ mappings: Map<string, { "@id"?: string }> | Record<string, { "@id"?: string }> }>;
};

export type TStandardTerm = { term: string; iri: string };

type TContext = Record<string, unknown>;
const isObject = (v: unknown): v is TContext => typeof v === "object" && v !== null && !Array.isArray(v);
const mapEntries = (m: Map<string, { "@id"?: string }> | Record<string, { "@id"?: string }>): [string, { "@id"?: string }][] =>
	m instanceof Map ? [...m.entries()] : Object.entries(m);

// One base active context per prefix set (haibun's top-level prefixes), so a standardContext using CURIEs resolves; and
// one resolved term list per (context url, class): the context documents are static.
const baseCache = new Map<string, Promise<unknown>>();
const scopedCache = new Map<string, Promise<TStandardTerm[]>>();

function baseContext(prefixSig: string, prefixes: TContext): Promise<unknown> {
	let p = baseCache.get(prefixSig);
	if (!p) {
		// jsonld needs an initial active context (processContext(null, null)) before a local context can be applied to it.
		p = jsonld.processContext(null, null, { documentLoader }).then((initial) => jsonld.processContext(initial, prefixes, { documentLoader }) as unknown);
		baseCache.set(prefixSig, p);
	}
	return p;
}

/** The genuine term→IRI the standardContext at `url` declares in its `classLabel` type scope, resolved by jsonld over the
 *  haibun prefix base. Empty when the document (or its type scope) is a shape this consumer does not resolve. */
function scopedTermsOf(url: string, classLabel: string, base: unknown): Promise<TStandardTerm[]> {
	const key = `${url}\n${classLabel}`;
	let p = scopedCache.get(key);
	if (!p) {
		p = (async () => {
			try {
				const doc = (await documentLoader(url)).document as { "@context"?: unknown };
				const ctx = doc["@context"];
				const scoped = isObject(ctx) ? (ctx[classLabel] as TContext | undefined)?.["@context"] : undefined;
				if (scoped === undefined) return [];
				const beforeKeys = new Set(mapEntries((base as { mappings: Map<string, { "@id"?: string }> }).mappings).map(([t]) => t));
				const active = await jsonld.processContext(base, scoped, { documentLoader });
				return mapEntries(active.mappings).flatMap(([term, def]) => {
					if (beforeKeys.has(term) || term.startsWith("@")) return [];
					const iri = def?.["@id"];
					return typeof iri === "string" && !iri.startsWith("@") ? [{ term, iri }] : [];
				});
			} catch {
				return [];
			}
		})();
		scopedCache.set(key, p);
	}
	return p;
}

/** Per-type, the standard-vocabulary terms it conforms to but does not itself model (declared-not-present), keyed by
 *  persistedAs. Derived from the ONE assembled @context: haibun's declared field names (the scoped object) name the
 *  present properties; each referenced standardContext's type-scoped terms are resolved by jsonld; the difference is
 *  returned. Only persisted types that declare standardContexts appear. */
export async function enumerateStandardVocab(domains: Record<string, TRegisteredDomain>): Promise<Map<string, TStandardTerm[]>> {
	const context = (getJsonLdContext(domains) as { "@context": TContext })["@context"];
	// Only absolute-IRI prefixes seed the base context; a relative binding (haibun's "/ns/") is not a valid @context @id
	// and jsonld rejects it. Standard contexts that use CURIEs still resolve; ones that use full IRIs need no prefixes.
	const prefixes: TContext = Object.fromEntries(Object.entries(context).filter(([, v]) => typeof v === "string" && /^[a-z][a-z0-9+.-]*:/i.test(v)));
	const prefixSig = JSON.stringify(prefixes);
	const base = await baseContext(prefixSig, prefixes);
	const byType = new Map<string, TStandardTerm[]>();
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		if (!d.topology.standardContexts?.length) continue;
		const typeNode = context[d.topology.persistedAs] as { "@context"?: unknown } | undefined;
		const typeCtx = typeNode?.["@context"];
		const parts = Array.isArray(typeCtx) ? typeCtx : [typeCtx];
		const scopedObj = parts.find(isObject) as TContext | undefined;
		const urls = parts.filter((p): p is string => typeof p === "string");
		const presentNames = new Set(Object.keys(scopedObj ?? {}).filter((k) => !k.startsWith("@")));
		const seen = new Set<string>();
		const declared: TStandardTerm[] = [];
		for (const url of urls) {
			for (const t of await scopedTermsOf(url, d.topology.persistedAs, base)) {
				if (presentNames.has(t.term) || seen.has(t.term)) continue;
				seen.add(t.term);
				declared.push(t);
			}
		}
		if (declared.length) byType.set(d.topology.persistedAs, declared);
	}
	return byType;
}

/** Test-only: clear the memoized context resolutions. */
export function resetStandardVocabCache(): void {
	baseCache.clear();
	scopedCache.clear();
}
