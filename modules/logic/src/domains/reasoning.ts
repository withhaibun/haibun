/**
 * The reasoner's declarations: the built-ins and terms of the haibun namespace that N3 rules name, what a reasoning session
 * returns, and a proof. EYE runs the rules on the same swipl-wasm runtime as the step program. Every graph is open
 * but a graph its type declares complete, which the rules read as one formula, so scoped negation (`log:notIncludes`) over
 * it is a closed check.
 */
import { z } from "zod";
import { CountedFields, MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import { listOf } from "@haibun/core/lib/domains/lists.js";
import type { AccessLevel, TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { IndividualAddressSchema } from "@haibun/core/lib/domains/typed-links.js";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import type { TFact } from "./logic.js";

/** The namespace of the built-ins and terms that haibun's N3 rules name. */
export const REASONER_NAMESPACE = "urn:haibun:";
/** The built-ins a rule calls, by name: `(subject predicate) h:read object` reads the store through a read effect, and
 *  `(kind argument …) h:effect outcome` performs one of haibun's effects of a proof, whose request is the list. */
export const REASONER_BUILTIN = { read: `${REASONER_NAMESPACE}read`, effect: `${REASONER_NAMESPACE}effect` } as const;
/** The rule sets the logic module holds as N3 files, each read by its name: goals over producer rules and their query, the step
 *  graph's lint and its query, a permission's containment and its query, the rules of OWL 2 RL a query of members reads, and
 *  waypoints' proofs. */
export const RULE_SET = {
	goals: "goals",
	goalsQuery: "goals-query",
	lint: "lint",
	lintQuery: "lint-query",
	containment: "containment",
	containmentQuery: "containment-query",
	owlRl: "owl-rl",
	waypoints: "waypoints",
} as const;
export type TRuleSet = (typeof RULE_SET)[keyof typeof RULE_SET];
/** A rule set a reasoning reads: one of the logic module's by its name, or another module's N3 file by its URL. */
export type TRuleSource = TRuleSet | URL;
/** `<class> h:complete { … }` states a complete graph's contents as one formula. Only a graph its type declares complete is stated so. */
export const COMPLETE_GRAPH = `${REASONER_NAMESPACE}complete`;
/** A value a session passes to the host or the host returns: an IRI or a literal, a string, a number, or a list of values. */
export type TReasonerValue = Term | string | number | readonly TReasonerValue[];
/** The effect a session needs: a read of the facts of a subject and a predicate, each an IRI, or one of haibun's effects of a
 *  proof, whose request is a list that names its kind first. */
export type TReasonerRead = { need: "read"; subject: NamedNode; predicate: NamedNode };
export type TReasonerEffect = { need: "effect"; request: readonly TReasonerValue[] };
/** How a session step ended: the effect it needs, or the N3 text of what the query derived. */
export type TReasonerState = TReasonerRead | TReasonerEffect | { derived: string };
/** What a session needs, as a refusal names it: the predicate and the subject of a read, or the kind of an effect. */
export const neededBy = (state: TReasonerRead | TReasonerEffect): string =>
	state.need === "read" ? `a read of ${state.predicate.value} of ${state.subject.value}` : `the effect ${JSON.stringify(state.request[0])}`;
/** What a reasoning reads: the logic module's rule sets it reads, its own N3 rules and facts, the query that selects what it
 *  returns, and the types whose complete graphs its rules close over. */
export type TReasoning = { ruleSets: readonly TRuleSource[]; rules: string; query: string; closedOver: readonly string[] };
/** The records of a type a reasoning reads at most. A read stops there and states that it stopped, so a graph read in part
 *  stays open and a claim its records don't prove stays unknown. */
export const REASONING_READ_CEILING = MAX_PAGE_ROWS;
/** A type's records as a reasoning reads them: their facts, and whether the read stopped at `REASONING_READ_CEILING`. */
export type TTypeRead = { facts: TFact[]; truncated: boolean };
/** A graph the rules close over that is open to the reader: its type's records are held at a level above the reader's, or
 *  the read of them stopped at its ceiling. */
export type TOpenGraph = { graph: string; accessLevel: AccessLevel } | { graph: string; readCeiling: number };
/** A step of a proof: what it gives, as the triples of its formula, and how. An inference rests on the steps its evidence
 *  names and applies its rule; an extraction reads its formula from a source. A rule's formula isn't a triple, so a step
 *  that gives a rule gives an empty list of triples. */
export type TProofStep = { step: Term; kind: TProofKind; gives: Quad[]; evidence: Term[]; rule?: Term; source?: Term };
/** The kinds of a proof's steps. */
export const PROOF_KIND = { proof: "proof", inference: "inference", extraction: "extraction" } as const;
export type TProofKind = (typeof PROOF_KIND)[keyof typeof PROOF_KIND];
/** A proof: what it concludes, each of its steps, and the N3 EYE wrote of it in the N3 proof vocabulary, which a record keeps. */
export type TProof = { gives: Quad[]; steps: TProofStep[]; text: string };
/** An explained reasoning: the proof of what its query selects, and the graphs its rules close over that are open to the reader,
 *  so a claim the proof doesn't give is unknown because of them. */
export type TExplained = { proof: TProof; open: TOpenGraph[] };

/** The namespace of the classes a query's rules name for the parts of its class expression. */
export const QUERY_NAMESPACE = `${REASONER_NAMESPACE}query#`;
/** The domain of a class expression, which `individuals of` reads. */
export const DOMAIN_CLASS_EXPRESSION = "class-expression";
/** The domain of the members a query entails. */
export const DOMAIN_ENTAILED_MEMBERS = "entailed-members";
/** The members a class expression entails, each by its address, and how many there are. A member the records don't entail may exist. */
export const EntailedMembersSchema = z.object({ members: z.array(IndividualAddressSchema), ...CountedFields });

/** A class expression's domain without the refusal its stepper adds, which reads the expression against the ontology. */
export const classExpressionDomainDefinition: TDomainDefinition = {
	selectors: [DOMAIN_CLASS_EXPRESSION],
	schema: z.string().min(1),
	written: true,
	description: "A class expression in Manchester syntax: a named class, and, or, {property} some {class}, {property} value {Type:id}, and inverse {property}",
};
export const reasoningDomainDefinitions: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_ENTAILED_MEMBERS],
		schema: EntailedMembersSchema,
		list: listOf(EntailedMembersSchema, "members"),
		description: "The records a class expression entails as its members. Others may exist that the records don't entail.",
	},
];
