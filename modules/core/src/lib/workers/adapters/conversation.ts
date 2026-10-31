/**
 * A conversation with a task of the worker pool: the task requests an effect, its caller replies, and the task's next request or
 * its output follows, until the task returns. The caller's replies run one at a time in the order it sends them, and an end
 * replies to each request that follows with a closing reply, so the task returns. EYE's sessions and PGlite's databases each hold
 * one conversation.
 */
import type { TWorkerTask } from "../domains/worker-task.js";
import type { IWorkerPool } from "../ports.js";
import { serialQueue } from "../../domains/serial-queue.js";

/** What a task stated last: a request its caller replies to, or the output it returned. */
export type TTurn<O> = { request: unknown } | { output: O };

/** A conversation: its first turn, a reply that returns the turn after it, and its end, which replies `closing` to each request
 *  that follows and waits for the task to return. */
export type TConversation<O> = { first: Promise<TTurn<O>>; reply(value: unknown): Promise<TTurn<O>>; end(closing: unknown): Promise<void> };

/** Starts a conversation with `task` over `input` in `pool`. */
export function converse<I, O>(pool: IWorkerPool, task: TWorkerTask<I, O>, input: I): TConversation<O> {
	let turn = Promise.withResolvers<TTurn<O>>();
	let replying: PromiseWithResolvers<unknown> | undefined;
	let closing: { value: unknown } | undefined;
	const ran = pool.run(task, input, (request) => {
		if (closing !== undefined) return Promise.resolve(closing.value);
		replying = Promise.withResolvers<unknown>();
		turn.resolve({ request });
		return replying.promise;
	});
	ran.then(
		(output) => turn.resolve({ output }),
		(err: unknown) => turn.reject(err),
	);
	const inTurn = serialQueue();
	const first = turn.promise;
	return {
		first,
		reply: (value) =>
			inTurn(() => {
				const held = replying;
				if (held === undefined) return Promise.reject(new Error(`${task.name} replied where it doesn't request an effect. Reply only to the request a turn returned.`));
				replying = undefined;
				turn = Promise.withResolvers<TTurn<O>>();
				held.resolve(value);
				return turn.promise;
			}),
		end: (value) =>
			inTurn(async () => {
				closing = { value };
				replying?.resolve(value);
				replying = undefined;
				await ran.catch(() => undefined);
			}),
	};
}
