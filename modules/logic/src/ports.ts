/**
 * The logic engine's port: the query that starts a proof of a line, the query that resumes it with the outcome of the effect it
 * needed, the removal of what the engine holds for a proof and a line's proof as N3; and the reasoner's sessions, which run one
 * at a time.
 */
import type { TProofState } from "./domains/logic.js";
import type { Term } from "@rdfjs/types";
import type { TReasonerState, TRuleSet } from "./domains/reasoning.js";

export type TLogicEngine = {
	/** Starts the proof of a line's term. Returns how it ended, or the effect it needs. */
	prove: (top: string, term: string) => TProofState;
	/** Resumes a line's proof with the outcome of the effect it needed. Returns its verdict, or the next effect it needs. */
	resume: (top: string, outcome: string) => TProofState;
	/** Removes what the engine holds for a line once its proof ended. */
	forget: (top: string) => void;
	/** A line's proof as N3, under a namespace: each proved call as a fact, and each node as the rules of its reading. */
	n3: (namespace: string, top: string) => string;
};

/** A session of the reasoner: it starts EYE over N3 sources and a query, and resumes it with the rows of the read it needed. */
export type TReasonerSession = {
	/** Starts the session over its sources and query. An explained session's derived text is the proof of what the query selects. */
	start: (sources: string, query: string, explained: boolean) => Promise<TReasonerState>;
	/** Resumes with the objects the read found. */
	resume: (rows: readonly Term[]) => TReasonerState;
};

/** The reasoner: it runs each session once the sessions before it ended, and holds the rule sets a session reads, each N3 text
 *  that parsed when it was read. */
export type TReasoner = { session: <T>(run: (session: TReasonerSession) => Promise<T>) => Promise<T>; rules: (set: TRuleSet) => string };
