/**
 * The worker pool on Piscina's `worker_threads` pool. A task's worker imports its module, which exports the function
 * `runTask` builds; the pool passes the task a port of its own, on which its input and each effect it requests cross. The pool
 * holds at most `MAX_WORKERS` workers, each within `MAX_WORKER_HEAP_MB` of heap, runs one task at a time in each, so a task's
 * worker state is its own while it runs, and releases a worker idle for `WORKER_IDLE_MS`.
 */
import { setFlagsFromString } from "node:v8";
import { MessageChannel } from "node:worker_threads";
import { Piscina } from "piscina";
import { EffectRequestSchema, type TEffectReply, type TPerformEffect, type TWorkerTask } from "../domains/worker-task.js";
import type { IWorkerPool } from "../ports.js";

/** The most workers the pool holds, which bounds the tasks that run at once, nested ones among them. */
export const MAX_WORKERS = 8;
/** The heap a worker holds at most, beside the memory a WebAssembly runtime it starts holds. */
const MAX_WORKER_HEAP_MB = 512;
/** How long a worker stays idle before the pool releases it. */
export const WORKER_IDLE_MS = 30_000;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The process's Node arguments without its export conditions: a task's module imports each package by its build, as a
 *  dependency does, whatever conditions the process that starts the worker resolves its own modules under. */
function workerArguments(argv: readonly string[]): string[] {
	const kept: string[] = [];
	for (let at = 0; at < argv.length; at++) {
		const arg = argv[at];
		if (arg === "--conditions" || arg === "-C") at += 1;
		else if (arg !== undefined && !arg.startsWith("--conditions=")) kept.push(arg);
	}
	return kept;
}

/**
 * The V8 flag that keeps WebAssembly code until its module is collected. Workers share a module's compiled code, as PGlite's and
 * EYE's runtimes do, and V8 24's collection of code one worker no longer runs, while another worker runs the same module, fails
 * its check `jit_page_->allocations_.erase(addr) == 1` in `ThreadIsolation::UnregisterWasmAllocation` and aborts the process.
 */
const KEEP_WASM_CODE = "--no-wasm-code-gc";

/** Returns a worker pool that releases a worker idle for `idleMs`. V8's flags are the process's, so the pool sets its flag for
 *  every isolate before its first worker starts. */
export function piscinaPool(idleMs: number): IWorkerPool {
	setFlagsFromString(KEEP_WASM_CODE);
	const pool = new Piscina({
		maxThreads: MAX_WORKERS,
		minThreads: 0,
		concurrentTasksPerWorker: 1,
		idleTimeout: idleMs,
		resourceLimits: { maxOldGenerationSizeMb: MAX_WORKER_HEAP_MB },
		execArgv: workerArguments(process.execArgv),
	});
	return {
		threads: () => pool.threads.length,
		close: () => pool.destroy(),
		run: async <I, O>(task: TWorkerTask<I, O>, input: I, perform?: TPerformEffect): Promise<O> => {
			const { port1: here, port2: there } = new MessageChannel();
			here.on("message", (message: unknown) => {
				const { id, request } = EffectRequestSchema.parse(message);
				const replied = (reply: TEffectReply) => here.postMessage(reply);
				if (perform === undefined) return replied({ id, failed: `the task ${task.name} requested an effect, and its caller doesn't perform effects` });
				perform(request).then(
					(reply) => replied({ id, reply }),
					(err: unknown) => replied({ id, failed: errorText(err) }),
				);
			});
			try {
				const running: Promise<unknown> = pool.run(Piscina.move(there), { filename: task.module.href, name: "default" });
				here.postMessage({ input: task.input.parse(input) });
				return task.output.parse(await running);
			} finally {
				here.close();
			}
		},
	};
}

let shared: IWorkerPool | undefined;
/** The process's worker pool, which every task of the process runs in, started on its first request. */
export function workerPool(): IWorkerPool {
	if (shared === undefined) shared = piscinaPool(WORKER_IDLE_MS);
	return shared;
}
