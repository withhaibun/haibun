/**
 * Reads the vocabularies a deployment declares from the copies the logic module holds in its `vocabularies` folder, checks each
 * against the digest its registry entry pins, and registers its axioms: the subsumptions and the disjointness of two named
 * classes, and the inverse functional properties, which the reasoner applies under OWL 2 RL, and the count of the other axioms, which the file states and the
 * reasoner doesn't reason over. A file is read once in a process.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Parser } from "n3";
import { OWL, RDF, RDFS } from "@haibun/core/lib/domains/vocabularies.js";
import { registerVocabulary, registeredVocabularies, vocabularyEntry, type TVocabularyAxioms, type TVocabularyEntry } from "@haibun/core/lib/domains/vocabulary-registry.js";

/** Returns a vocabulary's axioms from the copy the logic module holds. Throws where the copy's digest isn't the one the entry
 *  pins, since the axioms a reasoning reads would then not be the published ones. */
export function vocabularyAxioms(entry: TVocabularyEntry): TVocabularyAxioms {
	const text = readFileSync(createRequire(import.meta.url).resolve(`@haibun/logic/vocabularies/${entry.file}`));
	const digest = createHash("sha256").update(text).digest("hex");
	if (digest !== entry.digest)
		throw new Error(
			`the copy of ${entry.title} (${entry.file}) has the digest ${digest}, and its registry entry pins ${entry.digest}. Restore the file published at ${entry.source}.`,
		);
	const quads = new Parser({ format: entry.mediaType }).parse(text.toString("utf-8"));
	const named = quads.filter(({ subject, object }) => subject.termType === "NamedNode" && object.termType === "NamedNode");
	const pairs = (predicate: string) => [
		...new Map(named.filter((q) => q.predicate.value === predicate).map((q) => [`${q.subject.value} ${q.object.value}`, [q.subject.value, q.object.value] as const])).values(),
	];
	// The axioms the reasoner applies: a subsumption and a disjointness of two named classes, and an inverse functional property.
	const [subClassOf, disjointWith] = [pairs(RDFS.subClassOf), pairs(OWL.disjointWith)];
	const inverseFunctional = [...new Set(pairs(RDF.type).flatMap(([property, type]) => (type === OWL.InverseFunctionalProperty ? [property] : [])))];
	return { entry, subClassOf, disjointWith, inverseFunctional, stated: quads.length - subClassOf.length - disjointWith.length - inverseFunctional.length };
}

/** Registers each vocabulary of `prefixes` that isn't registered yet. */
export function declareVocabularies(prefixes: readonly TVocabularyEntry["prefix"][]): void {
	const held = new Set(registeredVocabularies().map(({ entry }) => entry.prefix));
	for (const prefix of prefixes) if (!held.has(prefix)) registerVocabulary(vocabularyAxioms(vocabularyEntry(prefix)));
}
