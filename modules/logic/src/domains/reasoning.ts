/**
 * The reasoner's declarations: the built-ins and terms of the haibun namespace that N3 rules name, what a reasoning session
 * returns, and a derived triple. EYE runs the rules on the same swipl-wasm runtime as the step program. Every graph is open
 * but a graph its type declares complete, which the rules read as one formula, so scoped negation (`log:notIncludes`) over
 * it is a closed check.
 */
import { z } from "zod";

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
