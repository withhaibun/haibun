/**
 * The logic engine's port: the query that starts a proof of a line or of goals over producer rules, the query that resumes it
 * with the outcome of the effect it needed, the removal of what the engine holds for a proof, a line's proof as N3, and the
 * step graph's lint.
 */
import type { TLintFinding } from "@haibun/core/lib/domains/goal-resolution.js";
import type { TProofState } from "./domains/logic.js";

export type TLogicEngine = {
	/** Starts the proof of a line's term or of goals. Returns how it ended, or the effect it needs. */
	prove: (top: string, term: string) => TProofState;
	/** Resumes a line's proof with the outcome of the effect it needed. Returns its verdict, or the next effect it needs. */
	resume: (top: string, outcome: string) => TProofState;
	/** Removes what the engine holds for a line once its proof ended. */
	forget: (top: string) => void;
	/** A line's proof as N3, under a namespace: each proved call as a fact, and each node as the rules of its reading. */
	n3: (namespace: string, top: string) => string;
	/** The step graph's lint findings, from its declarations as the engine's term. */
	lint: (graph: string) => TLintFinding[];
};
