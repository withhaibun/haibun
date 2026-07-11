/**
 * Enumerate the property vocabulary a type's declared standard context(s) define — the terms a conforming instance MAY
 * carry, beyond the fields haibun's topology models. A VerifiableCredential declaring the W3C VC v2 context yields its
 * type-scoped terms (issuer, credentialSubject, credentialStatus, credentialSchema, evidence, termsOfUse, …). The schema
 * projection folds these in as Property nodes so a type view shows a standard's whole vocabulary, marking which the data
 * never uses.
 *
 * Runs server-side only (Node), where core's document loader resolves the context — a consumer (e.g. the credential
 * steppers) registers the context documents + a resolver into core's loader, so this stays open-ended: it names no
 * consumer vocabulary and simply reads whatever context a type declares. A context that no registered resolver can
 * resolve yields no terms (the type just gets no extra vocabulary) rather than failing the schema assembly.
 */
import { documentLoader } from "@haibun/core/lib/jsonld-loader.js";
import { isPersisted, type TRegisteredDomain } from "@haibun/core/lib/resources.js";

export type TStandardTerm = { term: string; iri: string };

const scopedCache = new Map<string, TStandardTerm[]>();

type TContextDoc = { "@context"?: Record<string, unknown> };
type TTermDef = { "@id"?: string; "@context"?: Record<string, unknown> };

const iriOf = (def: unknown): string | undefined => {
	if (typeof def === "string") return def;
	const id = (def as TTermDef)?.["@id"];
	return typeof id === "string" ? id : undefined;
};

/** The terms a context's TYPE-SCOPED sub-context declares for `classLabel` (the credential's own properties), as
 *  term→IRI. Keyword aliases (id→@id, type→@type) and keyword-valued terms are dropped — they are not vocabulary. */
async function scopedTermsOf(url: string, classLabel: string): Promise<TStandardTerm[]> {
	const key = `${url}\n${classLabel}`;
	const cached = scopedCache.get(key);
	if (cached) return cached;
	let terms: TStandardTerm[] = [];
	try {
		const { document } = await documentLoader(url);
		const ctx = (document as TContextDoc)["@context"];
		const scoped = (ctx?.[classLabel] as TTermDef | undefined)?.["@context"];
		if (scoped) {
			terms = Object.entries(scoped).flatMap(([term, def]) => {
				if (term.startsWith("@")) return [];
				const iri = iriOf(def);
				return iri && !iri.startsWith("@") ? [{ term, iri }] : [];
			});
		}
	} catch {
		// no registered resolver for this context — the type gets no extra standard vocabulary.
	}
	scopedCache.set(key, terms);
	return terms;
}

/** Per-type standard vocabulary, keyed by persistedAs — every declared standardContext's type-scoped terms, deduped by
 *  term name. Only persisted types that declare standardContexts appear. */
export async function enumerateStandardVocab(domains: Record<string, TRegisteredDomain>): Promise<Map<string, TStandardTerm[]>> {
	const byType = new Map<string, TStandardTerm[]>();
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const urls = d.topology.standardContexts ?? [];
		if (urls.length === 0) continue;
		const seen = new Set<string>();
		const terms: TStandardTerm[] = [];
		for (const url of urls) {
			for (const t of await scopedTermsOf(url, d.topology.persistedAs)) {
				if (seen.has(t.term)) continue;
				seen.add(t.term);
				terms.push(t);
			}
		}
		if (terms.length) byType.set(d.topology.persistedAs, terms);
	}
	return byType;
}

/** Test-only: clear the memoized context enumerations. */
export function resetStandardVocabCache(): void {
	scopedCache.clear();
}
