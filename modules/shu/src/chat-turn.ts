/**
 * The request a turn this page asks runs on, as the adapter that raises the conversation's events for it.
 *
 * The run records the question first, and that record names the turn. A stop is an event like any other, and its
 * request's rejection ends the turn as stopped. A turn stopped before its request is sent is aborted at once. A turn
 * stopped after is aborted once the run has recorded its question: aborted between, the run can record a question the
 * page never hears of, which asking again would record a second time.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SCOPE, activeEntry, scopeEntry, type TEntry, type TSubjectState } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import { requireStep } from "./rpc-registry.js";
import { reportToRun } from "./client-log.js";
import { ASK_STEP, askRefusal, conversationState, dispatchConversationEvent, type TAskedTurn } from "./conversation.js";
import { TurnEnvelopeSchema, type TBundle, type TTurnEnvelope } from "./schemas.js";

/** What a turn sends besides its prompt: its bundle's patterns go in the envelope, which states the rest. */
type TTurnRequest = { prompt: string; bundle: TBundle; envelope: Omit<TTurnEnvelope, "patterns">; target: string };

/** What the next question is made of: the active entry, whose bundle it carries, and the turn it replies to. The turn
 *  is the actions bar's entry where that entry names one, and the transcript shows the branch that ends at it. */
export function nextQuestion(state: TSubjectState): { carries: TEntry | null; repliesTo: TEntry | null } {
	const conversation = scopeEntry(state, SCOPE.actionsBar);
	return { carries: activeEntry(state), repliesTo: conversation?.turn ? conversation : null };
}

/** The events a turn's streamed chunks carry. Text is raised at most once a frame, so a stream faster than the page draws
 *  moves the turn once per drawn frame, and `flush` raises what is held before the turn ends. */
class ChunkEvents {
	#text = "";
	#frame: number | undefined;

	raise = (chunk: TStreamChunk): void => {
		if (chunk.recorded) dispatchConversationEvent({ type: "recorded", record: { id: chunk.recorded.id, label: chunk.recorded.persistedAs } });
		if (chunk.status) dispatchConversationEvent({ type: "status", line: chunk.status });
		if (!chunk.text) return;
		this.#text += chunk.text;
		this.#frame ??= requestAnimationFrame(this.flush);
	};

	flush = (): void => {
		if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
		this.#frame = undefined;
		if (this.#text) dispatchConversationEvent({ type: "text", piece: this.#text });
		this.#text = "";
	};
}

/**
 * Ask a turn over the request stream, or throw the refusal where the conversation refuses a question now. The promise
 * resolves with the turn as it ended. A turn that does not complete is reported to the run, so the run's log holds the
 * error it shows.
 */
export async function startTurn(request: TTurnRequest): Promise<TAskedTurn | null> {
	const refusal = askRefusal(conversationState.get());
	if (refusal) throw new Error(refusal);
	const { prompt, bundle, envelope } = request;
	// Stated before the turn is asked, so an envelope that does not serialize is refused and leaves no turn in flight.
	const context = JSON.stringify(TurnEnvelopeSchema.parse({ patterns: bundle.patterns, ...envelope }));
	const { asked } = dispatchConversationEvent({ type: "ask", prompt, patterns: bundle.patterns, session: envelope.session, inReplyTo: envelope.inReplyTo });
	const abort = new AbortController();
	const unsubscribe = conversationState.subscribe(({ asked: turn }) => {
		if (turn?.stoppedBy && (turn.status === "asking" || turn.askId !== null)) abort.abort();
	});
	const chunks = new ChunkEvents();
	try {
		await conduit().followStream(acts(requireStep(ASK_STEP), { prompt, context, accessLevel: bundle.accessLevel, target: request.target }), chunks.raise, {
			why: "chat-turn: stream the turn's answer",
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
	const ended = conversationState.get().asked ?? asked;
	if (ended?.status === "failed" || ended?.status === "stopped") reportToRun("error", "chat-turn", `chat turn ${ended.status}: ${ended.error}`);
	return ended;
}
