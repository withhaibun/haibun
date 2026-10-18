/**
 * Reads the terms of the standard vocabularies a type conforms to and doesn't model. A type's assembled JSON-LD
 * `@context` (getJsonLdContext) names the type's fields and the standard contexts it references. The jsonld processor
 * resolves each standard context's type-scoped terms to their IRIs, and the terms that the type's fields don't name are
 * returned. A context the processor can't resolve returns an empty list for that context.
 */
import { z } from "zod";
import { jsonld as jsonldRaw, documentLoader } from "../../jsonld-loader.js";
import { getJsonLdContext } from "../../domains/hypermedia.js";
import { errorDetail } from "../../util/index.js";
import { isPersisted, type TRegisteredDomain } from "../../resources.js";
import type { TStandardTerm } from "../derivations/ontology.js";

/** A context jsonld has processed: each term with its definition. */
type TActiveContext = { mappings: Map<string, { "@id"?: string }> | Record<string, { "@id"?: string }> };
const jsonld: { processContext: (active: unknown, localCtx: unknown, opts?: unknown) => Promise<TActiveContext> } = jsonldRaw;
/** A JSON-LD document the loader holds, which may state a context. */
const ContextDocumentSchema = z.looseObject({ "@context": z.unknown().optional() });

/** Receives the reason a standard context's terms were left out. */
export type TVocabularyWarning = (message: string) => void;

type TContext = Record<string, unknown>;
const isObject = (v: unknown): v is TContext => typeof v === "object" && v !== null && !Array.isArray(v);
const mapEntries = (m: Map<string, { "@id"?: string }> | Record<string, { "@id"?: string }>): [string, { "@id"?: string }][] =>
	m instanceof Map ? [...m.entries()] : Object.entries(m);

// One base context per set of prefixes, and one term list per context and class. The registered context documents don't change.
const baseCache = new Map<string, Promise<TActiveContext>>();
const scopedCache = new Map<string, Promise<TStandardTerm[]>>();

function baseContext(prefixSig: string, prefixes: TContext): Promise<TActiveContext> {
	let held = baseCache.get(prefixSig);
	if (!held) {
		// jsonld applies a local context to an active context, so the base starts from the initial context.
		held = jsonld.processContext(null, null, { documentLoader }).then((initial) => jsonld.processContext(initial, prefixes, { documentLoader }));
		baseCache.set(prefixSig, held);
	}
	return held;
}

/** Returns the terms the standard context at `url` declares in its `classLabel` scope, resolved over the prefix base. A
 *  context without that scope returns an empty list. A context the loader doesn't hold returns an empty list and is reported to `warn`. */
function scopedTermsOf(url: string, classLabel: string, base: TActiveContext, warn: TVocabularyWarning): Promise<TStandardTerm[]> {
	const key = `${url}\n${classLabel}`;
	let held = scopedCache.get(key);
	if (!held) {
		held = (async () => {
			try {
				const ctx = ContextDocumentSchema.parse((await documentLoader(url)).document)["@context"];
				const typeScope = isObject(ctx) ? ctx[classLabel] : undefined;
				const scoped = isObject(typeScope) ? typeScope["@context"] : undefined;
				if (scoped === undefined) return [];
				const beforeKeys = new Set(mapEntries(base.mappings).map(([t]) => t));
				const active = await jsonld.processContext(base, scoped, { documentLoader });
				return mapEntries(active.mappings).flatMap(([term, def]) => {
					if (beforeKeys.has(term) || term.startsWith("@")) return [];
					const iri = def?.["@id"];
					return typeof iri === "string" && !iri.startsWith("@") ? [{ term, iri }] : [];
				});
			} catch (err) {
				warn(`The ontology leaves out the terms of ${classLabel} in ${url}, since the scoped context isn't readable: ${errorDetail(err)}`);
				return [];
			}
		})();
		scopedCache.set(key, held);
	}
	return held;
}

/** Returns each persisted type's standard terms that the type doesn't model, by the type. A type that doesn't reference a
 *  standard context isn't in the map. */
export async function enumerateStandardVocab(domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<Map<string, TStandardTerm[]>> {
	const context = getJsonLdContext(domains)["@context"];
	// Only a prefix bound to an absolute IRI seeds the base context, since jsonld rejects a relative binding such as haibun's "/ns/".
	const prefixes: TContext = Object.fromEntries(Object.entries(context).filter(([, v]) => typeof v === "string" && /^[a-z][a-z0-9+.-]*:/i.test(v)));
	const base = await baseContext(JSON.stringify(prefixes), prefixes);
	const byType = new Map<string, TStandardTerm[]>();
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		if (!d.topology.standardContexts?.length) continue;
		const typeNode = context[d.topology.persistedAs];
		const typeCtx = isObject(typeNode) ? typeNode["@context"] : undefined;
		const parts: unknown[] = Array.isArray(typeCtx) ? typeCtx : [typeCtx];
		const scopedObj = parts.find(isObject);
		const urls = parts.filter((p): p is string => typeof p === "string");
		const presentNames = new Set((scopedObj === undefined ? [] : Object.keys(scopedObj)).filter((k) => !k.startsWith("@")));
		const seen = new Set<string>();
		const declared: TStandardTerm[] = [];
		for (const url of urls) {
			for (const t of await scopedTermsOf(url, d.topology.persistedAs, base, warn)) {
				if (presentNames.has(t.term) || seen.has(t.term)) continue;
				seen.add(t.term);
				declared.push(t);
			}
		}
		if (declared.length) byType.set(d.topology.persistedAs, declared);
	}
	return byType;
}
