/**
 * Reads the proof EYE writes where it explains what it derived, in the W3C N3 proof vocabulary (`r:Proof`, `r:Inference`,
 * `r:Extraction`): each step with what it gives, the steps it rests on, the rule it applied and the source it read. N3.js's
 * parser reads EYE's N3, its formulas as graphs and its lists as `rdf:first` and `rdf:rest`.
 */
import { DataFactory, Store } from "n3";
import type { Quad, Term } from "@rdfjs/types";
import { LOG, OWL, RDF, RDFS, REASON } from "@haibun/core/lib/domains/vocabularies.js";
import { PROOF_KIND, type TProof, type TProofKind, type TProofStep } from "../domains/reasoning.js";
import { quadsOf } from "./n3.js";

const { namedNode } = DataFactory;
const KIND_OF: ReadonlyMap<string, TProofKind> = new Map([
	[REASON.Proof, PROOF_KIND.proof],
	[REASON.Inference, PROOF_KIND.inference],
	[REASON.Extraction, PROOF_KIND.extraction],
]);

/** The items of a list the proof states. The empty list is `rdf:nil`. Throws where the term isn't a list, since the proof vocabulary states evidence as one. */
function listAt(lists: Record<string, Term[]>, list: Term): Term[] {
	if (list.value === RDF.nil) return [];
	const items = lists[list.value];
	if (items === undefined) throw new Error(`EYE's proof states evidence ${list.value}, which isn't a list. Read a proof EYE wrote.`);
	return items;
}

/** Reads EYE's proof: its conclusion, and each step with what it gives, its evidence, its rule and its source. Where the query
 *  selects an empty set, EYE writes an empty text, which reads as a proof that gives an empty list. */
export function proofOf(text: string): TProof {
	const store = new Store(quadsOf(text));
	const lists = store.extractLists();
	// A proof's structure is in its default graph; each formula's triples are in a graph of their own.
	const objects = (subject: Term, predicate: string): Term[] => store.getObjects(subject, namedNode(predicate), DataFactory.defaultGraph());
	// The triples of a formula, apart from the rules it holds, which aren't triples.
	const triplesIn = (formula: Term): Quad[] => store.getQuads(null, null, null, formula).filter((q) => q.predicate.value !== LOG.implies);
	const steps = store.getSubjects(namedNode(RDF.type), null, DataFactory.defaultGraph()).flatMap((step): TProofStep[] => {
		const [kind] = objects(step, RDF.type).flatMap((type) => {
			const known = KIND_OF.get(type.value);
			return known === undefined ? [] : [known];
		});
		// A subject the proof types otherwise, such as the parsing a source names, isn't a step.
		if (kind === undefined) return [];
		// Evidence names the steps it rests on; a built-in's fact EYE states in place, as a blank node, isn't a step.
		const evidence = objects(step, REASON.evidence).flatMap((list) => listAt(lists, list).filter((item) => item.termType === "NamedNode"));
		const [rule] = objects(step, REASON.rule);
		const source = objects(step, REASON.because).flatMap((because) => objects(because, REASON.source))[0];
		return [
			{
				step,
				kind,
				gives: objects(step, REASON.gives).flatMap(triplesIn),
				evidence: [...evidence, ...objects(step, REASON.component)],
				...(rule === undefined ? {} : { rule }),
				...(source === undefined ? {} : { source }),
			},
		];
	});
	if (steps.length === 0) return { gives: [], steps, text };
	const proof = steps.find(({ kind }) => kind === PROOF_KIND.proof);
	if (proof === undefined) throw new Error("EYE's explanation doesn't state its proof. Run EYE with its proof explanation.");
	return { gives: proof.gives, steps, text };
}

/** Returns the facts and axioms a proof read from its sources, each once: what its extractions give. */
export function extractedBy({ steps }: TProof): Quad[] {
	const read = steps.flatMap(({ kind, gives }) => (kind === PROOF_KIND.extraction ? gives : []));
	return [...new Map(read.map((q) => [`${q.subject.value} ${q.predicate.value} ${q.object.value}`, q])).values()];
}

/** Returns the axiom a triple states in OWL 2 functional syntax, each term by the name `nameOf` gives it: a subsumption, a
 *  disjointness, a membership, or a property's assertion of a value. */
export function functionalAxiom({ subject, predicate, object }: Quad, nameOf: (term: Term) => string): string {
	const [s, o] = [nameOf(subject), nameOf(object)];
	if (predicate.value === RDFS.subClassOf) return `SubClassOf(${s} ${o})`;
	if (predicate.value === OWL.disjointWith) return `DisjointClasses(${s} ${o})`;
	if (predicate.value === RDF.type) return `ClassAssertion(${o} ${s})`;
	return `${object.termType === "Literal" ? "DataPropertyAssertion" : "ObjectPropertyAssertion"}(${nameOf(predicate)} ${s} ${o})`;
}
