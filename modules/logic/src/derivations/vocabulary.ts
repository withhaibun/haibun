/**
 * The closure of the ontology's classes under the registered vocabularies' class axioms, which a reasoning reads beside the
 * ontology: each class the ontology names, with every superclass the declarations and the vocabularies reach from it, and each
 * disjointness of two of those classes. It is derived once for a declaration set and a registry, so a session reads the
 * subsumptions it applies already chained and only the classes a record or a claim can reach, rather than every axiom of
 * every vocabulary.
 */
import { DataFactory, Writer } from "n3";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { OWL, RDFS } from "@haibun/core/lib/domains/vocabularies.js";
import { registeredVocabularies } from "@haibun/core/lib/domains/vocabulary-registry.js";

/** A class's superclasses by its IRI, which `supers` adds to under one key. */
const adding = (supers: Map<string, string[]>, sub: string, sup: string): void => {
	const held = supers.get(sub);
	supers.set(sub, held === undefined ? [sup] : [...held, sup]);
};

/** Returns the closure of `classes`, each by its IRI, as N-Triples: each class's subsumption by each class `declared` and the
 *  registered vocabularies reach from it, and the disjointness of two classes the closure holds that a vocabulary or
 *  `disjoint` states. */
export function vocabularyClosure(classes: readonly string[], declared: ReadonlyArray<readonly [string, string]>, disjoint: ReadonlyArray<readonly [string, string]>): string {
	const vocabularies = registeredVocabularies();
	const supers = new Map<string, string[]>();
	for (const [sub, sup] of declared) adding(supers, sub, sup);
	for (const { subClassOf } of vocabularies) for (const [sub, sup] of subClassOf) adding(supers, sub, sup);
	const ancestorsOf = (start: string): Set<string> => {
		const reached = new Set<string>();
		const pending = [start];
		while (pending.length > 0) {
			const at = pending.pop();
			const held = at === undefined ? undefined : supers.get(at);
			for (const sup of held === undefined ? [] : held) if (!reached.has(sup) && sup !== start) reached.add(sup), pending.push(sup);
		}
		return reached;
	};
	const closed = new Map(classes.map((cls) => [cls, ancestorsOf(cls)]));
	for (const ancestors of [...closed.values()]) for (const ancestor of ancestors) if (!closed.has(ancestor)) closed.set(ancestor, ancestorsOf(ancestor));
	const { namedNode, quad } = DataFactory;
	const pairs = [...disjoint, ...vocabularies.flatMap(({ disjointWith }) => disjointWith)].filter(([a, b]) => closed.has(a) && closed.has(b));
	const quads = [
		...[...closed].flatMap(([cls, ancestors]) => [...ancestors].map((ancestor) => quad(namedNode(cls), namedNode(RDFS.subClassOf), namedNode(ancestor)))),
		...pairs.map(([a, b]) => quad(namedNode(a), namedNode(OWL.disjointWith), namedNode(b))),
	];
	return new Writer({ format: MEDIA_TYPE.nTriples }).quadsToString(quads);
}
