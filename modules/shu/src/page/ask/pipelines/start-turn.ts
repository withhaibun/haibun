/**
 * Sends a turn's streaming request from this page and raises the conversation's events from the streamed chunks.
 *
 * Actuality records the question first, and that record names the turn. A stop is a conversation event, and the rejection
 * of its request ends the turn as stopped. A turn stopped before its request is sent is aborted at once. A turn stopped
 * after that is aborted once actuality has recorded its question. An abort between the two can leave a recorded question
 * that the page doesn't receive; where the reader sends the question again, actuality records it a second time.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import type { TCalled } from "@haibun/core/lib/called.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { delegatedActions, readAction, readCeilingOf, seenAt } from "@haibun/core/lib/actions.js";
import { Access, storeScopeFor } from "@haibun/core/lib/resources.js";
import { ASK_PARAM, CONVERSATION_DOMAIN, TurnEnvelopeSchema, TurnKeySchema, type TTurnEnvelope } from "@haibun/core/lib/conversation/domains/conversation.js";
import { acts } from "../../domains/links.js";
import { recordOf } from "../../../current-subject.js";
import type { TAskedTurn } from "../domains/conversation.js";
import { askRefusal } from "../machines/conversation.js";
import type { TTurnScope } from "../ports.js";

/** What a turn sends: its words, the envelope that states its subject and the turn it replies to, and the target model. */
export type TTurnRequest = { prompt: string; envelope: TTurnEnvelope; target: string };

/**
 * Returns the delegation the page signs to the turn's key, which states what a turn from this page may do. It grants a
 * read at the page's access level, capped at the page's read ceiling. It grants each action the page holds from two lists:
 * the actions the instance names for a turn, and the actions the reader allowed its turns. Returns undefined where the
 * deployment doesn't verify a delegation; there a turn holds what the deployment allows without one.
 */
async function turnDelegation(scope: TTurnScope): Promise<Record<string, unknown> | undefined> {
	if (!scope.verifiesDelegations()) return undefined;
	const open = scope.steps()?.turnKey;
	if (open === undefined)
		throw new Error(`this deployment verifies delegations, and actuality doesn't declare a step that returns ${CONVERSATION_DOMAIN.TURN_KEY}, which opens a turn's key`);
	const turn = TurnKeySchema.parse(await scope.conduit().follow(acts(open.method), "start-turn: open the turn's key"));
	const ceiling = readCeilingOf([...scope.holds()]);
	if (ceiling === undefined)
		throw new Error(
			`a turn reads records, and this page's key doesn't hold a read action: capability ${readAction(Access.public)} required. Request it from the key that delegates the page's actions.`,
		);
	const reads = seenAt(storeScopeFor(scope.readLevel()), ceiling);
	const given = [...new Set([...turn.actions, ...(await scope.allowance())])].filter((action) => scope.may(action));
	return await scope.delegate({ controller: turn.controller, wanted: [readAction(reads), ...given], expires: turn.expires, target: scope.origin() });
}

/** Raises the conversation events a turn's streamed chunks carry. Text, context lines and calls are raised at most once a
 *  frame, so a stream faster than the page draws updates the turn once per drawn frame. Any other chunk first raises the
 *  held context lines and calls, so the records the turn reached are activated in stream order. `flush` raises what is
 *  held before the turn ends. */
class ChunkEvents {
	#text = "";
	#context: string[] = [];
	#calls: TCalled[] = [];
	#frame: (() => void) | undefined;

	constructor(private readonly scope: TTurnScope) {}

	raise = (chunk: TStreamChunk): void => {
		const dispatch = this.scope.conversation.dispatch.bind(this.scope.conversation);
		if (chunk.recorded || chunk.status || chunk.refused) this.raiseStated();
		if (chunk.recorded) dispatch({ type: "recorded", record: recordOf(chunk.recorded) });
		if (chunk.status) dispatch({ type: "status", line: chunk.status });
		if (chunk.refused) dispatch({ type: "refused", call: chunk.refused });
		if (chunk.text) this.#text += chunk.text;
		if (chunk.context) this.#context.push(chunk.context);
		if (chunk.called) this.#calls.push(chunk.called);
		if ((chunk.text || chunk.context || chunk.called) && this.#frame === undefined) this.#frame = this.scope.clock.frame(this.flush);
	};

	/** Raises the held context lines and calls. */
	private raiseStated(): void {
		if (this.#context.length) this.scope.conversation.dispatch({ type: "context", lines: this.#context.splice(0) });
		if (this.#calls.length) this.scope.conversation.dispatch({ type: "called", calls: this.#calls.splice(0) });
	}

	flush = (): void => {
		this.#frame?.();
		this.#frame = undefined;
		this.raiseStated();
		if (this.#text) this.scope.conversation.dispatch({ type: "text", piece: this.#text });
		this.#text = "";
	};
}

/**
 * Sends a turn's question over the request stream. Throws the conversation's refusal where the conversation refuses a
 * new question. The promise resolves with the turn's final state. A turn that doesn't complete is reported to actuality,
 * so actuality's log holds the error the turn shows. A turn is sent at the page's current read level, which the address
 * can have narrowed after the turn's records were activated.
 */
export async function startTurn(scope: TTurnScope, { prompt, envelope, target }: TTurnRequest): Promise<TAskedTurn> {
	const refusal = askRefusal(scope.conversation.state.get());
	if (refusal) throw new Error(refusal);
	const ask = scope.steps()?.ask;
	if (ask === undefined) throw new Error(`actuality doesn't declare a step that takes ${CONVERSATION_DOMAIN.QUESTION} and returns ${CONVERSATION_DOMAIN.RESPONSE}`);
	// Parses and states the envelope before the `ask` event, so an envelope that fails the schema or holds a value JSON
	// doesn't state throws and doesn't leave a turn in flight.
	const delegation = await turnDelegation(scope);
	const stated = TurnEnvelopeSchema.parse({ ...envelope, ...(delegation ? { delegation } : {}) });
	const question = JSON.stringify(stated);
	const delegated = delegation ? delegatedActions(delegation) : [];
	scope.conversation.dispatch({ type: "ask", prompt, patterns: stated.patterns, session: stated.session, inReplyTo: stated.inReplyTo, delegated });
	const abort = new AbortController();
	const unsubscribe = scope.conversation.state.subscribe(({ asked: turn }) => {
		if (turn?.stoppedBy && (turn.status === "asking" || turn.askId !== null)) abort.abort();
	});
	const chunks = new ChunkEvents(scope);
	const params = { [ASK_PARAM.prompt]: prompt, [ASK_PARAM.question]: question, [ASK_PARAM.readLevel]: scope.readLevel(), [ASK_PARAM.model]: target };
	try {
		await scope
			.conduit()
			.followStream(acts(ask.method, params), chunks.raise, {
				why: "start-turn: stream the turn's response",
				signal: abort.signal,
				onStart: () => scope.conversation.dispatch({ type: "started" }),
			});
		chunks.flush();
		scope.conversation.dispatch({ type: "ended" });
	} catch (err) {
		chunks.flush();
		scope.conversation.dispatch({ type: "erred", message: errorDetail(err) });
	} finally {
		unsubscribe();
	}
	const ended = scope.conversation.state.get().asked;
	if (!ended) throw new Error("the conversation doesn't hold the turn this page started, because the turn was cleared while it ran. Send the question again.");
	if (ended.status === "failed" || ended.status === "stopped") scope.report(`chat turn ${ended.status}: ${ended.error}`);
	return ended;
}
