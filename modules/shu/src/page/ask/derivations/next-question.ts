/**
 * The parts of the next question: the active entry, whose bundle the question carries, and the turn to which it replies.
 */
import type { TSubjectState } from "../../machines/current-subject.js";
import { activeEntry, scopeEntry } from "../../derivations/current-subject.js";
import { SCOPE, type TEntry } from "../../domains/current-subject.js";

/** Returns the active entry and the turn to which the next question replies. The question replies to the actions bar's entry
 *  where that entry names a turn, and the transcript shows the branch that ends at that turn. */
export function nextQuestion(state: TSubjectState): { carries: TEntry | null; repliesTo: TEntry | null } {
	const conversation = scopeEntry(state, SCOPE.actionsBar);
	return { carries: activeEntry(state), repliesTo: conversation?.turn ? conversation : null };
}
