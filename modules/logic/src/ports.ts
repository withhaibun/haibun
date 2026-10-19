/**
 * The logic engine's port: the query that starts a line's proof, the query that resumes it with the outcome of the effect
 * it needed, the removal of what the engine holds for a line, a line's proof as N3, the proofs of goals over producer rules,
 * and the step graph's lint.
 */
import type { TLintFinding } from "@haibun/core/lib/domains/goal-resolution.js";
import type { TGoalProof, TProofState } from "./domains/logic.js";

export type TLogicEngine = {
	/** Starts the proof of a line's term. Returns its verdict, or the effect it needs. */
	prove: (top: string, term: string) => TProofState;
	/** Resumes a line's proof with the outcome of the effect it needed. Returns its verdict, or the next effect it needs. */
	resume: (top: string, outcome: string) => TProofState;
	/** Removes what the engine holds for a line once its proof ended. */
	forget: (top: string) => void;
	/** A line's proof as N3, under a namespace: each proved call as a fact, and each node as the rules of its reading. */
	n3: (namespace: string, top: string) => string;
	/** Proves each goal over producer rules and the facts that hold, both as the engine's term. */
	goals: (rules: string, goals: readonly string[]) => TGoalProof[];
	/** The step graph's lint findings, from its declarations as the engine's term. */
	lint: (graph: string) => TLintFinding[];
};
