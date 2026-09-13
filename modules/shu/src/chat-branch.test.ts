/**
 * The path a transcript shows through a branching conversation: the turns down to the turn the conversation is on, the
 * newest replies below it, and the other branches offered where they leave the path.
 */
import { describe, expect, it } from "vitest";
import { branchPath } from "./chat-branch.js";
import type { TChatMessage } from "./components/shu-chat-message.js";

let id = 0;
/** One turn's question and reply, replying to `inReplyTo`. */
const turn = (seqPath: string | undefined, inReplyTo?: string): TChatMessage[] =>
	(["user", "llm"] as const).map((role) => ({
		id: `m${++id}`,
		role,
		text: `${role} ${seqPath ?? "pending"}`,
		seqPath,
		inReplyTo,
		spinnerStatus: "",
		activity: [],
		spinnerVisible: false,
		spinnerSpinning: false,
		error: "",
	}));
const turnsShown = (messages: TChatMessage[]) => [...new Set(messages.map((m) => m.seqPath ?? "pending"))];

// The first turn, a reply to it, a reply to that, and a later second reply to the first turn: two branches from the first.
const SESSION = [...turn("0.1.1"), ...turn("0.1.2", "0.1.1"), ...turn("0.1.3", "0.1.2"), ...turn("0.1.4", "0.1.1")];

describe("the path a transcript shows", () => {
	it("follows the newest turn where the conversation is on none, down its branch from the first turn", () => {
		const { shown, others } = branchPath(SESSION, undefined);
		expect(turnsShown(shown)).toEqual(["0.1.1", "0.1.4"]);
		expect(others.get("0.1.1")?.latest.seqPath, "the other branch, offered by its latest message").toBe("0.1.3");
		expect(others.get("0.1.1")?.latest.role).toBe("llm");
		expect(others.get("0.1.1")?.count).toBe(1);
	});

	it("follows the turn the conversation is on, and the newest replies below it", () => {
		expect(turnsShown(branchPath(SESSION, "0.1.2").shown), "the older branch, to its leaf").toEqual(["0.1.1", "0.1.2", "0.1.3"]);
		expect(branchPath(SESSION, "0.1.2").others.get("0.1.1")?.latest.seqPath, "and the newer branch offered").toBe("0.1.4");
		expect(turnsShown(branchPath(SESSION, "0.1.1").shown), "an earlier turn shows its newest continuation").toEqual(["0.1.1", "0.1.4"]);
	});

	it("shows a question just sent, before the run names its turn, on the branch it replies to", () => {
		const sending = [...SESSION, ...turn(undefined, "0.1.2")];
		const { shown, others } = branchPath(sending, "0.1.2");
		expect(turnsShown(shown)).toEqual(["0.1.1", "0.1.2", "pending"]);
		expect(others.get("0.1.2")?.latest.seqPath, "the reply it branched from offers the turn after it").toBe("0.1.3");
	});

	it("shows every turn of a conversation that never branched, and offers nothing", () => {
		const straight = [...turn("0.2.1"), ...turn("0.2.2", "0.2.1")];
		expect(branchPath(straight, "0.2.2").shown).toEqual(straight);
		expect(branchPath(straight, undefined).others.size).toBe(0);
	});

	it("shows nothing for a conversation with no turns", () => {
		expect(branchPath([], undefined)).toEqual({ shown: [], others: new Map() });
	});
});
