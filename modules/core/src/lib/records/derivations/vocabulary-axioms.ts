/**
 * The registered vocabularies' axioms over an ontology's classes, which the server adds to the ontology it derives from the
 * declarations, so the graph and the Class records state what the reasoner applies: each class a registered vocabulary
 * defines names the vocabulary's published file, its superclasses in that vocabulary are classes of the ontology up to the
 * vocabulary's roots, so a type's chain to its standard classes reads as a path, and two classes of the ontology a
 * vocabulary states disjoint are linked as disjoint.
 */
import { CLASS_LABEL } from "../../domains/resources.js";
import { NAMESPACE } from "../../domains/vocabularies.js";
import { registeredVocabularies, vocabularyOf } from "../../domains/vocabulary-registry.js";
import type { TClusteredQuads, TQuad } from "../../steps/domains/quad-types.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { categoryOf, quadOf, superMap } from "./ontology.js";

const CURIE = /^([A-Za-z][\w-]*):(?!\/\/)(.+)$/;

/** The IRI a class's name stands for where its prefix is one a vocabulary namespace binds, else undefined. */
function iriOfName(name: string): string | undefined {
	const curie = CURIE.exec(name);
	const namespace = curie?.[1] === undefined ? undefined : (NAMESPACE as Record<string, string>)[curie[1]];
	return namespace === undefined || curie?.[2] === undefined ? undefined : `${namespace}${curie[2]}`;
}

/** The name an IRI of a registered vocabulary takes: the vocabulary's prefix and the IRI's local name. */
function nameOfIri(iri: string): string | undefined {
	const held = vocabularyOf(iri);
	return held === undefined ? undefined : `${held.entry.prefix}:${iri.slice(NAMESPACE[held.entry.prefix].length)}`;
}

/** Returns the ontology with the registered vocabularies' axioms over its classes. An ontology is returned as it is where a
 *  vocabulary isn't registered. */
export function withVocabularyAxioms(ontology: TClusteredQuads): TClusteredQuads {
	const vocabularies = registeredVocabularies();
	if (vocabularies.length === 0) return ontology;
	const supers = new Map<string, string[]>();
	for (const { subClassOf } of vocabularies)
		for (const [sub, sup] of subClassOf) {
			const held = supers.get(sub);
			supers.set(sub, held === undefined ? [sup] : [...held, sup]);
		}
	const classCluster = ontology.clusters.find((c) => c.type === CLASS_LABEL);
	if (classCluster === undefined) throw new Error(`an ontology holds a ${CLASS_LABEL} cluster, and this one doesn't`);
	const names = new Set(classCluster.sampledSubjects);
	const added: TQuad[] = [];
	const subjects = [...classCluster.sampledSubjects];
	const labels = { ...classCluster.displayLabels };
	const addClass = (name: string): void => {
		if (names.has(name)) return;
		names.add(name);
		subjects.push(name);
		labels[name] = name;
		added.push(quadOf(name, ONTOLOGY_FIELD.name, name, CLASS_LABEL));
	};
	// Each class's superclasses in its vocabulary, up to the vocabulary's roots.
	const pending = [...names];
	while (pending.length > 0) {
		const name = pending.pop();
		const iri = name === undefined ? undefined : iriOfName(name);
		if (name === undefined || iri === undefined) continue;
		const held = supers.get(iri);
		for (const sup of held === undefined ? [] : held) {
			const supName = nameOfIri(sup);
			if (supName === undefined) continue;
			if (!names.has(supName)) pending.push(supName);
			addClass(supName);
			added.push(quadOf(name, ONTOLOGY_FIELD.subClassOf, supName, CLASS_LABEL, CLASS_LABEL));
		}
	}
	for (const name of names) {
		const iri = iriOfName(name);
		const held = iri === undefined ? undefined : vocabularyOf(iri);
		if (held !== undefined) added.push(quadOf(name, ONTOLOGY_FIELD.definedBy, held.entry.source, CLASS_LABEL));
	}
	// A class a vocabulary added takes its designation from its chain, as a class a type names does.
	const chains = superMap([...ontology.quads, ...added]);
	for (const name of subjects.slice(classCluster.sampledSubjects.length)) added.push(quadOf(name, ONTOLOGY_FIELD.category, categoryOf(name, chains), CLASS_LABEL));
	for (const { disjointWith } of vocabularies)
		for (const [a, b] of disjointWith) {
			const [aName, bName] = [nameOfIri(a), nameOfIri(b)];
			if (aName !== undefined && bName !== undefined && names.has(aName) && names.has(bName))
				added.push(quadOf(aName, ONTOLOGY_FIELD.disjointWith, bName, CLASS_LABEL, CLASS_LABEL));
		}
	const clusters = ontology.clusters.map((c) => (c === classCluster ? { ...c, sampledSubjects: subjects, displayLabels: labels } : c));
	return { quads: [...ontology.quads, ...added], clusters };
}
