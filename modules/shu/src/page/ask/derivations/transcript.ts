/**
 * The transcript of a conversation as a view shows it: each turn's question and response on the branch that contains the
 * turn a reader holds, and the other branch that leaves each turn on it.
 */
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import type { AccessQueryLevel } from "@haibun/core/lib/resources.js";
import type { TChatMessage } from "../components/shu-chat-message.js";
import type { TBundle } from "../../../schemas.js";
import { PENDING_TURN, SENDING, inFlight, type TConversationState, type TTurn } from "../domains/conversation.js";

/** A turn as the transcript shows it, with the bundle its messages carry. Its key is its question's record id, or
 *  `pending` before actuality records the question. */
type TShownTurn = Omit<TTurn, "bundle"> & { key: string; bundle: TBundle };

/** The parent key of a session's first questions. A conversation forks at its start as it forks at a turn. Another
 *  first question starts another branch of the same session. */
const START = "";

/**
 * Returns the turns on the branch the transcript shows, its first turn, and the other branch that leaves each turn on
 * it. The branch extends from the session's start to `onTurn`. Below `onTurn` it follows the newest reply to a leaf. An
 * unset or unknown `onTurn` selects the newest turn. The newest other branch is offered at each turn on the branch that
 * has replies off the branch. The offered branch references the response record of its newest leaf, or that leaf's
 * question record where the leaf doesn't have a recorded response. The other branch that leaves the start is keyed by
 * `START`.
 */
function branch(
	turns: TShownTurn[],
	onTurn: string | undefined,
): { onPath: Set<string>; first: string | undefined; others: Map<string, NonNullable<TChatMessage["otherBranch"]>> } {
	const byKey = new Map(turns.map((turn) => [turn.key, turn]));
	const childrenOf = new Map<string, string[]>();
	for (const turn of turns) {
		const parent = turn.inReplyTo !== undefined && byKey.has(turn.inReplyTo) ? turn.inReplyTo : START;
		const siblings = childrenOf.get(parent);
		if (siblings === undefined) childrenOf.set(parent, [turn.key]);
		else siblings.push(turn.key);
	}
	const newestLeafBelow = (key: string): string => {
		let at = key;
		for (let children = childrenOf.get(at); children?.length; children = childrenOf.get(at)) at = itemAt(children, children.length - 1);
		return at;
	};
	const onPath = new Set<string>();
	let first: string | undefined;
	const start = onTurn !== undefined && byKey.has(onTurn) ? onTurn : turns.at(-1)?.key;
	if (start === undefined) return { onPath, first, others: new Map() };
	for (let at: string | undefined = newestLeafBelow(start); at !== undefined && byKey.has(at) && !onPath.has(at); at = byKey.get(at)?.inReplyTo) {
		onPath.add(at);
		first = at;
	}
	const others = new Map<string, NonNullable<TChatMessage["otherBranch"]>>();
	for (const key of [START, ...onPath]) {
		const children = childrenOf.get(key);
		// A turn without replies doesn't have a branch that leaves it.
		if (children === undefined) continue;
		const off = children.filter((child) => !onPath.has(child));
		const latest = off.length > 0 ? byKey.get(newestLeafBelow(itemAt(off, off.length - 1))) : undefined;
		if (latest?.askId) others.set(key, { recordId: latest.sayId ?? latest.askId, turn: latest.askId, bundle: latest.bundle, count: off.length });
	}
	return { onPath, first, others };
}

/** One message of the transcript, whether the shown branch contains it, and the time its turn was sent. The timeline
 *  compares that time with the reader's place. */
type TTranscriptEntry = { message: TChatMessage; shown: boolean; askedAt: number | undefined };

/**
 * Returns the transcript's messages in order: each turn's question and response, keyed by the turn. Every turn's
 * messages are listed, so a view keeps each message where it first appeared. Turns off the branch that contains
 * `onTurn` aren't shown. The response where another branch leaves carries that branch. The first question shown
 * carries the branch that another first question of the session starts.
 */
export function transcript(conversation: TConversationState, onTurn: string | undefined, accessLevel: AccessQueryLevel): TTranscriptEntry[] {
	const turns = conversation.turns.map((turn) => ({ ...turn, key: turn.askId === null ? PENDING_TURN : turn.askId, bundle: { patterns: turn.bundle, accessLevel } }));
	const { onPath, first, others } = branch(turns, onTurn);
	const otherFirst = others.get(START);
	return turns.flatMap((turn): TTranscriptEntry[] => {
		const { key, askId, inReplyTo, status, progress, context, calls } = turn;
		const shown = onPath.has(key);
		const asked = Date.parse(turn.generatedAtTime);
		const askedAt = Number.isFinite(asked) ? asked : undefined;
		const running = inFlight(status);
		const otherBranch = others.get(key);
		const common = { turn: askId ?? undefined, inReplyTo, bundle: turn.bundle, spinnerSpinning: running, recordType: COMMENT_LABEL };
		return [
			{
				shown,
				askedAt,
				message: {
					...common,
					id: `${key}:ask`,
					role: "user",
					text: turn.prompt,
					recordId: askId ?? undefined,
					context: [],
					calls: [],
					spinnerStatus: "",
					spinnerVisible: false,
					// The first question shown carries the branch that another first question starts.
					...(key === first && otherFirst ? { otherBranch: otherFirst } : {}),
				},
			},
			{
				shown,
				askedAt,
				message: {
					...common,
					id: `${key}:say`,
					role: "llm",
					text: turn.response,
					status,
					recordId: turn.sayId,
					context,
					calls,
					// The spinner states that the turn is sending until the turn reports its progress.
					spinnerStatus: progress === "" ? SENDING : progress,
					spinnerVisible: running,
					error: turn.error,
					unverified: turn.unverified,
					...(otherBranch ? { otherBranch } : {}),
				},
			},
		];
	});
}
