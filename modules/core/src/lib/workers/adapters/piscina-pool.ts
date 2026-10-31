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

/** The Node options a worker takes from its process: warnings, source maps and experimental features. A worker refuses V8's
 *  options, such as `--expose-gc`, and options of the process, and a task's module imports each package by its build, as a
 *  dependency does, so it doesn't take the export conditions or the loaders its process resolves its own modules under. */
const WORKER_OPTIONS = ["--experimental-", "--no-experimental-", "--disable-warning=", "--no-warnings", "--no-deprecation", "--enable-source-maps", "--trace-warnings"];

/** The process's Node arguments a worker takes: each option `WORKER_OPTIONS` names, where a family, ending in `-`, and an option
 *  with its value, ending in `=`, are matched by their prefix. */
export function workerArguments(argv: readonly string[]): string[] {
	return argv.filter((arg) => WORKER_OPTIONS.some((option) => (/[-=]$/.test(option) ? arg.startsWith(option) : arg === option)));
}

/**
 * The V8 flag that keeps WebAssembly code until its module is collected: a workaround for a V8 defect, to remove once V8 fixes it.
 * Workers share a module's compiled code, as PGlite's and EYE's runtimes do, and V8's collection of code one worker no longer
 * runs, while another worker runs the same module, fails its check `jit_page_->allocations_.erase(addr) == 1` in
 * `ThreadIsolation::UnregisterWasmAllocation` and aborts the process (Node 24.21). The V8 and Node issues found name another check; Node
 * issue 29767 reports another wasm code collection abort that this flag stops. A module's code is still freed with the module.
 */
const KEEP_WASM_CODE = "--no-wasm-code-gc";
// V8's flags are the process's, and a module compiled before the flag is set keeps its code collectable, so the flag is set as
// this module loads, before a process that imports the pool compiles WebAssembly.
setFlagsFromString(KEEP_WASM_CODE);

/** How a pool holds its tasks past its bound: queued until a worker is free, or, for a resident task that holds its worker until
 *  it ends, such as a database, refused at once with its cause and remedy, so a task past the bound doesn't wait unseen. A
 *  resident task within the bound waits only while its worker starts. */
export const POOL_MODE = { queued: "queued", resident: "resident" } as const;
export type TPoolMode = (typeof POOL_MODE)[keyof typeof POOL_MODE];

/** Returns a worker pool that releases a worker idle for `idleMs`, and holds a task past its bound as `mode` states. */
export function piscinaPool(idleMs: number, mode: TPoolMode): IWorkerPool {
	const pool = new Piscina({
		maxThreads: MAX_WORKERS,
		minThreads: 0,
		concurrentTasksPerWorker: 1,
		idleTimeout: idleMs,
		resourceLimits: { maxOldGenerationSizeMb: MAX_WORKER_HEAP_MB },
		execArgv: workerArguments(process.execArgv),
	});
	// The resident tasks that run now, which a resident pool holds to its bound.
	let residents = 0;
	return {
		threads: () => pool.threads.length,
		close: () => pool.destroy(),
		run: async <I, O>(task: TWorkerTask<I, O>, input: I, perform?: TPerformEffect): Promise<O> => {
			if (mode === POOL_MODE.resident && residents >= MAX_WORKERS)
				throw new Error(`${task.name} needs a worker, and each of the ${MAX_WORKERS} resident workers holds a task until it ends. Close a resident task first.`);
			if (mode === POOL_MODE.resident) residents += 1;
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
				// The task parses its input, so the process passes it as its first message without parsing it again.
				here.postMessage({ input });
				return task.output.parse(await running);
			} finally {
				if (mode === POOL_MODE.resident) residents -= 1;
				here.close();
			}
		},
	};
}

let shared: IWorkerPool | undefined;
/** The process's worker pool, which every task of the process runs in, started on its first request. */
export function workerPool(): IWorkerPool {
	if (shared === undefined) shared = piscinaPool(WORKER_IDLE_MS, POOL_MODE.queued);
	return shared;
}

let resident: IWorkerPool | undefined;
/** The process's pool of resident tasks, each holding its worker until it ends, apart from the tasks the process's worker pool
 *  queues, so a resident task doesn't hold a worker for which those tasks wait. */
export function residentPool(): IWorkerPool {
	if (resident === undefined) resident = piscinaPool(WORKER_IDLE_MS, POOL_MODE.resident);
	return resident;
}
