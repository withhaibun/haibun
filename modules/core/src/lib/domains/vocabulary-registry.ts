/**
 * The vocabulary registry, beside the JSON-LD context registry: the published OWL and RDF files of the standard vocabularies
 * whose axioms the reasoner reads, each pinned by its version, the address it was published at and the SHA-256 digest of
 * the copy `@haibun/logic` holds in its `vocabularies` folder, so a reasoning doesn't reach a network. A deployment declares
 * the vocabularies it reads. The logic module reads each declared file, checks its digest and registers its axioms here:
 * the class axioms the reasoner applies under OWL 2 RL, a subsumption or a disjointness of two named classes, and the count
 * of the axioms it states that the reasoner doesn't reason over. Every disjointness a refuted claim cites is one a vocabulary states.
 */
import { MEDIA_TYPE } from "./media-types.js";
import { NAMESPACE } from "./vocabularies.js";

/** An entry of the registry: the vocabulary's prefix, title and version, the address its file was published at, the file the
 *  logic module holds, its media type, and the SHA-256 digest of that file. */
export type TVocabularyEntry = {
	prefix: keyof typeof NAMESPACE;
	title: string;
	version: string;
	source: string;
	file: string;
	mediaType: typeof MEDIA_TYPE.turtle | typeof MEDIA_TYPE.nQuads;
	digest: string;
};

/** The vocabularies the registry holds. Each copy is the published file as its source states it. */
export const VOCABULARY_ENTRIES: readonly TVocabularyEntry[] = [
	{
		prefix: "prov",
		title: "PROV-O",
		version: "W3C Recommendation 2013-04-30",
		source: "https://github.com/w3c/prov/blob/master/ontology/prov-o.ttl",
		file: "prov-o-20130430.ttl",
		mediaType: MEDIA_TYPE.turtle,
		digest: "3d03c8e15753178541fb8cd59fbefecaf1861f9c37ef75190c6e938b85fb0c3d",
	},
	{
		prefix: "foaf",
		title: "FOAF",
		version: "0.99 (2014-01-14), as @vocabulary/foaf 1.0.6 holds it",
		source: "http://xmlns.com/foaf/spec/index.rdf",
		file: "foaf-0.99.nq",
		mediaType: MEDIA_TYPE.nQuads,
		digest: "5115950fcfb8d8aaf2669fcc555eb8622151bed22d46384e097ea72b58dc2373",
	},
	{
		prefix: "as",
		title: "Activity Streams 2.0",
		version: "2.0 with its extensions, as @vocabulary/as 1.0.6 holds it",
		source: "https://www.w3.org/ns/activitystreams.owl",
		file: "activitystreams-2.0.nq",
		mediaType: MEDIA_TYPE.nQuads,
		digest: "cd03531932e6c2b3ec3842d26bd6e96313b897c72f3f70eb9502073dbb5235ed",
	},
	{
		prefix: "schema",
		title: "schema.org",
		version: "30.1",
		source: "https://github.com/schemaorg/schemaorg/blob/main/data/releases/30.1/schemaorg-current-https.ttl",
		file: "schemaorg-30.1-https.ttl",
		mediaType: MEDIA_TYPE.turtle,
		digest: "7f15ca89398c4f235f478a4b3b8d1f975d63c5a860b77c8a8fce01f791b7ae2f",
	},
];

/** Returns the registry's entry for a prefix. Throws where the registry doesn't hold one, naming the prefixes it holds. */
export function vocabularyEntry(prefix: string): TVocabularyEntry {
	const entry = VOCABULARY_ENTRIES.find((held) => held.prefix === prefix);
	if (entry === undefined) throw new Error(`the vocabulary registry doesn't hold ${prefix}. Declare one of ${VOCABULARY_ENTRIES.map((held) => held.prefix).join(", ")}.`);
	return entry;
}

/** A vocabulary's axioms as the reasoner reads them, each class by its IRI: the subsumptions and the disjointness of two named
 *  classes it applies under OWL 2 RL, and the count of the other axioms the file states, which are stated, not reasoned over. */
export type TVocabularyAxioms = {
	entry: TVocabularyEntry;
	subClassOf: ReadonlyArray<readonly [string, string]>;
	disjointWith: ReadonlyArray<readonly [string, string]>;
	stated: number;
};

const registered = /* @__PURE__ */ new Map<string, TVocabularyAxioms>();

/** Registers a declared vocabulary's axioms, which the logic module read from its file. */
export function registerVocabulary(axioms: TVocabularyAxioms): void {
	registered.set(axioms.entry.prefix, axioms);
}

/** The axioms of each vocabulary registered so far, in the order they were registered. */
export const registeredVocabularies = (): TVocabularyAxioms[] => [...registered.values()];

/** The registered vocabulary whose namespace holds an IRI, or undefined where a registered one doesn't. */
export const vocabularyOf = (iri: string): TVocabularyAxioms | undefined => registeredVocabularies().find(({ entry }) => iri.startsWith(NAMESPACE[entry.prefix]));

/** How an axiom names the vocabulary that states it: its title and version. */
export const vocabularyName = ({ title, version }: TVocabularyEntry): string => `${title} ${version}`;
