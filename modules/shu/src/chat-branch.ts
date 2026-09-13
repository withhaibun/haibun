/**
 * The path a transcript shows through a conversation that branches.
 *
 * A conversation is a tree of turns: each turn replies to one earlier turn, and a reader who asks about an earlier message
 * starts a second branch there. A transcript shows one path through the tree, the conversation tree's usual reading: from
 * the session's first turn to the turn the conversation is on, then along the newest reply below it to a leaf. Where a
 * turn on that path has replies off the path, the newest other branch is offered from that turn, by its latest message.
 */
import type { TChatMessage } from "./components/shu-chat-message.js";

/** A branch that leaves the shown path: the latest message on it, and how many branches leave at that turn. */
export type TOtherBranch = { latest: TChatMessage; count: number };

/** The turn a message belongs to: its seqPath once the run named it, and the question's id before that. */
const turnOf = (message: TChatMessage, questionId: string): string => message.seqPath ?? `pending:${questionId}`;

/**
 * The messages the transcript shows, in order, and the other branch that leaves each turn on the path, by the turn's
 * seqPath. `onTurn` is the turn the conversation is on; unset or unknown, the path follows the newest turn.
 */
export function branchPath(messages: readonly TChatMessage[], onTurn: string | undefined): { shown: TChatMessage[]; others: Map<string, TOtherBranch> } {
	// Each question opens a turn, and the reply after it belongs to the same turn.
	const turnKeys: string[] = [];
	let questionId = "";
	for (const message of messages) {
		if (message.role === "user") questionId = message.id;
		turnKeys.push(turnOf(message, questionId));
	}
	const order: string[] = [];
	const parentOf = new Map<string, string | undefined>();
	messages.forEach((message, at) => {
		const key = turnKeys[at];
		if (!parentOf.has(key)) {
			order.push(key);
			parentOf.set(key, message.inReplyTo);
		}
	});
	const childrenOf = new Map<string, string[]>();
	for (const key of order) {
		const parent = parentOf.get(key);
		if (parent !== undefined && parentOf.has(parent)) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), key]);
	}
	const newestLeafBelow = (key: string): string => {
		let at = key;
		for (let children = childrenOf.get(at); children?.length; children = childrenOf.get(at)) at = children[children.length - 1];
		return at;
	};
	const start = onTurn !== undefined && parentOf.has(onTurn) ? onTurn : order[order.length - 1];
	if (start === undefined) return { shown: [], others: new Map() };
	const path: string[] = [];
	for (let at: string | undefined = newestLeafBelow(start); at !== undefined && parentOf.has(at); at = parentOf.get(at)) path.unshift(at);
	const onPath = new Set(path);
	const others = new Map<string, TOtherBranch>();
	for (const key of path) {
		const off = (childrenOf.get(key) ?? []).filter((child) => !onPath.has(child));
		if (off.length === 0) continue;
		const leaf = newestLeafBelow(off[off.length - 1]);
		const latest = [...messages].reverse().find((message, fromEnd) => turnKeys[messages.length - 1 - fromEnd] === leaf);
		if (latest) others.set(key, { latest, count: off.length });
	}
	return { shown: messages.filter((_, at) => onPath.has(turnKeys[at])), others };
}
