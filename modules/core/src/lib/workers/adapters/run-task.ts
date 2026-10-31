/**
 * A task's side in its worker: `runTask` returns the function a task's module exports, which reads its input from the port the
 * pool passes it, runs the task with a way to request effects of its process over that port, and returns its output.
 */
import { once } from "node:events";
import type { MessagePort } from "node:worker_threads";
import { z } from "zod";
import { EffectReplySchema, type TPerformEffect } from "../domains/worker-task.js";

const PortSchema = z.custom<MessagePort>((value) => typeof value === "object" && value !== null && "postMessage" in value);
/** The first message on a task's port, which holds its input; each later message is the reply to an effect. */
const InputMessageSchema = z.strictObject({ input: z.unknown() });

/** Returns the function a task's module exports: it runs `run` over the input `input` parses, with `effect` requesting an effect of
 *  the task's process, and returns its output. */
export function runTask<I, O>(input: z.ZodType<I>, run: (taken: I, effect: TPerformEffect) => Promise<O>): (passed: unknown) => Promise<O> {
	return async (passed) => {
		const port = PortSchema.parse(passed);
		const [first] = await once(port, "message");
		const given = InputMessageSchema.parse(first).input;
		let next = 0;
		const waiting = new Map<number, { resolve: (reply: unknown) => void; reject: (err: Error) => void }>();
		port.on("message", (message: unknown) => {
			const reply = EffectReplySchema.parse(message);
			const held = waiting.get(reply.id);
			waiting.delete(reply.id);
			if ("failed" in reply) held?.reject(new Error(reply.failed));
			else held?.resolve(reply.reply);
		});
		const effect: TPerformEffect = (request) =>
			new Promise((resolve, reject) => {
				next += 1;
				waiting.set(next, { resolve, reject });
				port.postMessage({ id: next, request });
			});
		try {
			return await run(input.parse(given), effect);
		} finally {
			port.close();
		}
	};
}
