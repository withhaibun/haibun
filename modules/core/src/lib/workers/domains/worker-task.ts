/**
 * A task the worker pool runs off the event loop: its name, the module that runs it in a worker, and the schemas of what it takes
 * and returns, which each side parses. A task that needs its process while it runs, such as a read or a call, requests an effect,
 * which crosses as a message on the task's own port and returns its reply the same way.
 */
import { z } from "zod";

/** A task: its name, the module a worker imports to run it, and the schemas of what it takes and returns. */
export type TWorkerTask<I, O> = { name: string; module: URL; input: z.ZodType<I>; output: z.ZodType<O> };

/** An effect a task requests of its process, by its number, and the process's reply, or why the effect failed. */
export const EffectRequestSchema = z.object({ id: z.number(), request: z.unknown() });
export const EffectReplySchema = z.union([z.object({ id: z.number(), reply: z.unknown() }), z.object({ id: z.number(), failed: z.string() })]);
export type TEffectReply = z.infer<typeof EffectReplySchema>;

/** Performs an effect a task requests, and returns its reply. */
export type TPerformEffect = (request: unknown) => Promise<unknown>;

/** The module beside `from` named `name`: its source where `from` runs as its source, and else its build. */
export const siblingModule = (from: string, name: string): URL => new URL(`./${name}${from.endsWith(".ts") ? ".ts" : ".js"}`, from);
