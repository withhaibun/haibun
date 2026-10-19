/**
 * The logic engine's port: one query of a line's proof, the outcome of an effect the proof needed, the removal of a line's
 * outcomes once its proof completed, and a proof's export as N3.
 */
import type { TAttempt } from "./domains/logic.js";

export type TLogicEngine = {
	/** Evaluates the term of a line against the outcomes recorded for it. Returns its verdict and proof, or the effect it needs. */
	attempt: (top: string, term: string) => TAttempt;
	/** Records the outcome of an effect at a position of a line's proof. */
	record: (top: string, kind: string, path: readonly number[], outcome: string) => void;
	/** Removes the outcomes of a line whose proof completed. */
	forget: (top: string) => void;
	/** A proof as N3: each proved call as a fact, and each node as the rules of its reading, under a namespace. */
	n3: (namespace: string, proofTerm: string) => string;
};
