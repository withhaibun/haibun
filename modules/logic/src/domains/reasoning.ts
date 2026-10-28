/**
 * The reasoner's declarations: the built-ins and terms of the haibun namespace that N3 rules name, what a reasoning session
 * returns, and a derived triple. EYE runs the rules on the same swipl-wasm runtime as the step program. Every graph is open
 * but a graph its type declares complete, which the rules read as one formula, so scoped negation (`log:notIncludes`) over
 * it is a closed check.
 */
import { z } from "zod";
import { CountedFields } from "@haibun/core/lib/domains/hypermedia.js";
import { listOf } from "@haibun/core/lib/domains/lists.js";
import type { AccessLevel, TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { IndividualAddressSchema } from "@haibun/core/lib/domains/typed-links.js";

/** The namespace of the built-ins and terms that haibun's N3 rules name. */
export const REASONER_NAMESPACE = "urn:haibun:";
/** The built-ins a rule calls, by name: `(subject predicate) h:read object` reads the store through a read effect. */
export const REASONER_BUILTIN = { read: `${REASONER_NAMESPACE}read` } as const;
/** `<class> h:complete { … }` states a complete graph's contents as one formula. Only a graph its type declares complete is stated so. */
export const COMPLETE_GRAPH = `${REASONER_NAMESPACE}complete`;
/** The effect a session needs: a read of the facts of a subject and a predicate, each an IRI. */
export const ReasonerReadSchema = z.object({ need: z.literal("read"), subject: z.string(), predicate: z.string() });
export type TReasonerRead = z.infer<typeof ReasonerReadSchema>;
/** How a session step ended: the effect it needs, or the N3 text of what the query derived. */
export type TReasonerState = TReasonerRead | { derived: string };
/** A triple of derived N3, each term as N3 writes it: an IRI in angle brackets, a quoted literal, a number or a boolean. */
export type TTriple = { subject: string; predicate: string; object: string };
/** What a reasoning reads: its N3 rules and facts, the query that selects what it returns, and the types whose complete graphs
 *  its rules close over. */
export type TReasoning = { rules: string; query: string; closedOver: readonly string[] };
/** A graph the rules close over that is open to the reader, since its type's records are held at a level above the reader's. */
export type TOpenGraph = { graph: string; accessLevel: AccessLevel };
/** A step of a proof: what it gives, as the triples of its formula, and how. An inference rests on the steps its evidence
 *  names and applies its rule; an extraction reads its formula from a source. A rule's formula isn't a triple, so a step
 *  that gives a rule gives an empty list of triples. */
export type TProofStep = { step: string; kind: "proof" | "inference" | "extraction"; gives: TTriple[]; evidence: string[]; rule?: string; source?: string };
/** A proof: what it concludes, and each of its steps by its name. */
export type TProof = { gives: TTriple[]; steps: TProofStep[] };
/** An explained reasoning: the proof of what its query selects, and the graphs its rules close over that are open to the reader,
 *  so a claim the proof doesn't give is unknown because of them. */
export type TExplained = { proof: TProof; open: TOpenGraph[] };

/** The namespace of the classes a query's rules name for the parts of its class expression. */
export const QUERY_NAMESPACE = `${REASONER_NAMESPACE}query#`;
/** The rules of OWL 2 RL a query of members reads: a member of a class is a member of each superclass, and a fact of a property
 *  is a fact of each superproperty. */
export const OWL_RL_RULES = [
	"{ ?x a ?c . ?c <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?d } => { ?x a ?d } .",
	"{ ?s ?p ?o . ?p <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> ?q } => { ?s ?q ?o } .",
].join("\n");
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
