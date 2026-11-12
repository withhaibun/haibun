/**
 * The frames of EYE's proof of a contract's check, in the order a reader traverses a proof: the facts the check read are its
 * assumptions, the statements the relations' rules derived from them follow, and the relations' triples the check selected are
 * its conclusion. A relation's triple renders as the relation's assertion over its arguments, and any other fact as a property
 * assertion of the individual it states. Each frame names the individuals it states, which the graph view highlights, and the
 * step's record whose check it proves.
 */
import type { Quad, Term } from "@rdfjs/types";
import { RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { FRAME_KIND, type TFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { individualAxioms } from "@haibun/core/lib/records/derivations/axioms.js";
import { RELATION_NAMESPACE } from "@haibun/core/lib/steps/domains/contract.js";
import { PROOF_KIND, type TProof } from "../domains/reasoning.js";
import { extractedBy } from "./proof.js";

/** The parts of a proof, in the order a reader traverses them. */
const PROOF_PART = { assumption: "assumption", derived: "derived", conclusion: "conclusion" } as const;
type TProofPart = (typeof PROOF_PART)[keyof typeof PROOF_PART];

/** A proof's frames: its assumptions, and the statements it derived followed by its conclusion. */
export type TProofFrames = { readonly assumptions: readonly TFrame[]; readonly derived: readonly TFrame[] };

/** The predicates that state a list's structure, which a frame reads as its relation's arguments. */
const LIST_PREDICATES: ReadonlySet<string> = new Set([RDF.first, RDF.rest]);

const named = (terms: readonly Term[]): string[] => terms.flatMap((term) => (term.termType === "NamedNode" ? [term.value] : []));

/** A statement of a proof: its quad, its arguments, and the part of the proof that holds it. A relation's arguments are the items
 *  of the list its subject heads, and another fact's argument is its subject. */
type TStated = { quad: Quad; args: readonly Term[]; part: TProofPart };

/** Returns the frame of a statement, the `at`th of the proofs. */
function frameOf({ quad, args, part }: TStated, at: number, step: NonNullable<TFrame["assertedBy"]>): TFrame {
	const { subject, predicate, object } = quad;
	const relation = predicate.value.startsWith(RELATION_NAMESPACE) ? predicate.value.slice(RELATION_NAMESPACE.length) : undefined;
	const assertion = `${relation}(${args.map(({ value }) => value).join(", ")})`;
	const axioms =
		relation === undefined
			? individualAxioms(subject.value, [], [{ property: predicate.value, value: object.value, individual: object.termType === "NamedNode" }])
			: { manchester: assertion, dl: assertion };
	return {
		name: `${part} ${at}`,
		kind: FRAME_KIND.individual,
		...axioms,
		statement: `${part}: ${axioms.dl}`,
		assertedBy: step,
		nodes: relation === undefined ? named([subject, object]) : named(args),
		edges: [],
	};
}

/** Returns the statements of a proof in the order a reader traverses them, each once, in the last part that states it, so a
 *  derived statement the check selected is in the conclusion. */
function statedIn(proof: TProof): TStated[] {
	const argsOf = ({ subject, predicate }: Quad): readonly Term[] => {
		if (!predicate.value.startsWith(RELATION_NAMESPACE)) return [subject];
		const items = proof.lists[subject.value];
		if (items === undefined) throw new Error(`EYE's proof states a relation's triple whose subject ${subject.value} isn't a list. Read a proof of a contract's check.`);
		return items;
	};
	const stated = (quads: readonly Quad[], part: TProofPart): TStated[] =>
		quads.flatMap((quad) => (LIST_PREDICATES.has(quad.predicate.value) ? [] : [{ quad, args: argsOf(quad), part }]));
	const all = [
		...stated(extractedBy(proof), PROOF_PART.assumption),
		...proof.steps.filter(({ kind }) => kind === PROOF_KIND.inference).flatMap(({ gives }) => stated(gives, PROOF_PART.derived)),
		...stated(proof.gives, PROOF_PART.conclusion),
	];
	const keyOf = ({ quad, args }: TStated): string => [quad.predicate, ...args, quad.object].map(({ value }) => value).join(" ");
	return all.filter((one, at) => all.findLastIndex((other) => keyOf(other) === keyOf(one)) === at);
}

/** Returns the frames of each proof of `proofs`, in their order, as the proofs of the checks of the step whose record `step` names. */
export function proofFrames(proofs: readonly TProof[], step: NonNullable<TFrame["assertedBy"]>): TProofFrames {
	const stated = proofs.flatMap(statedIn);
	const framesOf = (assumed: boolean): TFrame[] => stated.flatMap((one, at) => ((one.part === PROOF_PART.assumption) === assumed ? [frameOf(one, at + 1, step)] : []));
	return { assumptions: framesOf(true), derived: framesOf(false) };
}
