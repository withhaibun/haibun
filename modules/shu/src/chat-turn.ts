/**
 * Sends a turn's streaming request from this page and raises the conversation's events from the streamed chunks.
 *
 * Actuality records the question first, and that record names the turn. A stop is a conversation event, and the rejection
 * of its request ends the turn as stopped. A turn stopped before its request is sent is aborted at once. A turn stopped
 * after that is aborted once actuality has recorded its question. An abort between the two can leave a recorded question
 * that the page doesn't receive. If the person asks the question again, actuality records it a second time.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import type { TCalled } from "@haibun/core/lib/called.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SCOPE, activeEntry, recordOf, scopeEntry, type TEntry, type TSubjectState } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import { deploymentVerifiesDelegations, requireStep } from "./rpc-registry.js";
import { delegateFromPage } from "./page-delegation.js";
import { delegatedActions, readAction, readCeilingOf, seenAt } from "@haibun/core/lib/actions.js";
import { Access, storeScopeFor } from "@haibun/core/lib/resources.js";
import { pageHolds, pageMay } from "./page-key.js";
import { readTurnAllowance } from "./turn-allowance.js";
import { reportToRun } from "./client-log.js";
import { ASK_STEP, OPEN_TURN_STEP, askRefusal, conversationState, dispatchConversationEvent, type TAskedTurn } from "./conversation.js";
import { TurnEnvelopeSchema, type TTurnEnvelope } from "./schemas.js";
import { appAccessLevel } from "./util.js";

/** What a turn sends: its prompt, the envelope that states its subject and the turn it replies to, and the target model. */
type TTurnRequest = { prompt: string; envelope: TTurnEnvelope; target: string };

/** Returns the parts of the next question: the active entry, whose bundle the question carries, and the turn it replies
 *  to. The question replies to the actions bar's entry where that entry names a turn. The transcript shows the branch
 *  that ends at that turn. */
export function nextQuestion(state: TSubjectState): { carries: TEntry | null; repliesTo: TEntry | null } {
	const conversation = scopeEntry(state, SCOPE.actionsBar);
	return { carries: activeEntry(state), repliesTo: conversation?.turn ? conversation : null };
}

/**
 * Returns the delegation the page signs to the turn's key, which states what a turn from this page may do. It grants a
 * read at the page's access level, capped at the page's read ceiling. It grants each action the page holds from two lists:
 * the actions the instance names for a turn, and the actions the reader allowed its turns. Returns undefined where the
 * deployment doesn't verify a delegation. There a turn holds what the deployment allows without one.
 */
async function turnDelegation(): Promise<Record<string, unknown> | undefined> {
	if (!deploymentVerifiesDelegations()) return undefined;
	const turn = await conduit().follow<{ controller: string; expires: string; actions: string[] }>(acts(requireStep(OPEN_TURN_STEP)), "chat-turn: open the turn's key");
	const reads = seenAt(storeScopeFor(appAccessLevel()), readCeilingOf(pageHolds()) ?? Access.public);
	const given = [...new Set([...turn.actions, ...(await readTurnAllowance())])].filter((action) => pageMay(action));
	return await delegateFromPage({ controller: turn.controller, wanted: [readAction(reads), ...given], expires: turn.expires, target: location.origin });
}

/** Raises the conversation events a turn's streamed chunks carry. Text, context lines and calls are raised at most once a
 *  frame, so a stream faster than the page draws updates the turn once per drawn frame. Any other chunk first raises the
 *  held context lines and calls, so the records the turn reached are activated in stream order. `flush` raises what is
 *  held before the turn ends. */
class ChunkEvents {
	#text = "";
	#context: string[] = [];
	#calls: TCalled[] = [];
	#frame: number | undefined;

	raise = (chunk: TStreamChunk): void => {
		if (chunk.recorded || chunk.status || chunk.refused) this.raiseStated();
		if (chunk.recorded) dispatchConversationEvent({ type: "recorded", record: recordOf(chunk.recorded) });
		if (chunk.status) dispatchConversationEvent({ type: "status", line: chunk.status });
		if (chunk.refused) dispatchConversationEvent({ type: "refused", call: chunk.refused });
		if (chunk.text) this.#text += chunk.text;
		if (chunk.context) this.#context.push(chunk.context);
		if (chunk.called) this.#calls.push(chunk.called);
		if (chunk.text || chunk.context || chunk.called) this.#frame ??= requestAnimationFrame(this.flush);
	};

	/** Raises the held context lines and calls. */
	private raiseStated(): void {
		if (this.#context.length) dispatchConversationEvent({ type: "context", lines: this.#context.splice(0) });
		if (this.#calls.length) dispatchConversationEvent({ type: "called", calls: this.#calls.splice(0) });
	}

	flush = (): void => {
		if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
		this.#frame = undefined;
		this.raiseStated();
		if (this.#text) dispatchConversationEvent({ type: "text", piece: this.#text });
		this.#text = "";
	};
}

/**
 * Sends a turn's question over the request stream. Throws the conversation's refusal where the conversation refuses a
 * new question. The promise resolves with the turn's final state. A turn that doesn't complete is reported to actuality,
 * so actuality's log holds the error the turn shows. A turn is sent at the page's current access level. The address can
 * have narrowed that level after the turn's records were activated.
 */
export async function startTurn({ prompt, envelope, target }: TTurnRequest): Promise<TAskedTurn> {
	const refusal = askRefusal(conversationState.get());
	if (refusal) throw new Error(refusal);
	// Parses the envelope before the `ask` event, so an envelope that fails the schema throws and doesn't leave a turn in flight.
	const delegation = await turnDelegation();
	const stated = TurnEnvelopeSchema.parse({ ...envelope, ...(delegation ? { delegation } : {}) });
	const context = JSON.stringify(stated);
	const delegated = delegation ? delegatedActions(delegation) : [];
	dispatchConversationEvent({ type: "ask", prompt, patterns: stated.patterns, session: stated.session, inReplyTo: stated.inReplyTo, delegated });
	const abort = new AbortController();
	const unsubscribe = conversationState.subscribe(({ asked: turn }) => {
		if (turn?.stoppedBy && (turn.status === "asking" || turn.askId !== null)) abort.abort();
	});
	const chunks = new ChunkEvents();
	try {
		await conduit().followStream(acts(requireStep(ASK_STEP), { prompt, context, accessLevel: appAccessLevel(), target }), chunks.raise, {
			why: "chat-turn: stream the turn's response",
			signal: abort.signal,
			onStart: () => dispatchConversationEvent({ type: "started" }),
		});
		chunks.flush();
		dispatchConversationEvent({ type: "ended" });
	} catch (err) {
		chunks.flush();
		dispatchConversationEvent({ type: "erred", message: errorDetail(err) });
	} finally {
		unsubscribe();
	}
	const ended = conversationState.get().asked;
	if (!ended) throw new Error("the conversation doesn't hold the turn this page started, because the turn was cleared while it ran. Ask the question again.");
	if (ended.status === "failed" || ended.status === "stopped") reportToRun("error", "chat-turn", `chat turn ${ended.status}: ${ended.error}`);
	return ended;
}
