/**
 * The worker pool's port: it runs a task off the event loop and returns what the task returns, performing each effect the task
 * requests while it runs, states how many workers it holds, and closes.
 */
import type { TPerformEffect, TWorkerTask } from "./domains/worker-task.js";

export interface IWorkerPool {
	/** Runs `task` over `input` in a worker, with `perform` performing each effect it requests, and returns its parsed output. */
	run<I, O>(task: TWorkerTask<I, O>, input: I, perform?: TPerformEffect): Promise<O>;
	/** How many workers the pool holds now: a worker idle past the pool's idle time is released. */
	threads(): number;
	/** Ends each worker, and each task it runs. */
	close(): Promise<void>;
}
