/**
 * A read a view shows, held in the load machine (`page/machines/load.ts`): a run starts the read, and its outcome completes
 * the machine with what it read, or fails it with the refusal. The view draws again at each move, and renders each status
 * through `render`.
 */
import type { ReactiveControllerHost } from "lit";
import { machine, type Machine } from "@haibun/core/lib/machines/machine.js";
import { INITIAL_LOAD, LOAD_EVENT, LOAD_STATUS, type TLoadEvent, type TLoadState } from "../domains/load.js";
import { loadTransition } from "../machines/load.js";
import type { TPageRefusal } from "../domains/refusal.js";
import type { TCallOutcome } from "../pipelines/call-step.js";

/** What a view renders for each status of a read. */
export type TLoadRenders<T, R> = { pending: () => R; running: () => R; completed: (page: T) => R; failed: (refusal: TPageRefusal) => R };

export class LoadController<T> {
	readonly #read: () => Promise<TCallOutcome<T>>;
	readonly #machine: Machine<TLoadState<T>, TLoadEvent<T>> = machine<TLoadState<T>, TLoadEvent<T>>(INITIAL_LOAD, loadTransition);
	/** The count of reads started, so a read that a later read replaced doesn't end the later read. */
	#started = 0;

	constructor(host: ReactiveControllerHost, read: () => Promise<TCallOutcome<T>>) {
		this.#read = read;
		this.#machine.follow(() => host.requestUpdate());
	}

	/** The read's state. */
	get state(): TLoadState<T> {
		return this.#machine.state.get();
	}

	/** Starts the read, and resolves once it ends. A read that a later run replaced doesn't move the machine. */
	async run(): Promise<void> {
		const started = ++this.#started;
		this.#machine.dispatch({ type: LOAD_EVENT.START });
		const outcome = await this.#read();
		if (started !== this.#started) return;
		this.#machine.dispatch(outcome.ok ? { type: LOAD_EVENT.COMPLETE, page: outcome.value } : { type: LOAD_EVENT.FAIL, refusal: outcome.refusal });
	}

	/** Reads again and keeps showing what the read completed with until the new read completes; a failed refresh keeps it,
	 *  as a live update of a view keeps what the view shows. A read that hasn't completed runs as `run` runs it. */
	async refresh(): Promise<void> {
		if (this.state.status !== LOAD_STATUS.COMPLETED) return this.run();
		const started = ++this.#started;
		const outcome = await this.#read();
		if (started === this.#started && outcome.ok) this.hold(outcome.value);
	}

	/** Holds `page` as a completed read's, for a view given what it shows without a read. A read under way doesn't end it. */
	hold(page: T): void {
		this.#started++;
		this.#machine.dispatch({ type: LOAD_EVENT.START });
		this.#machine.dispatch({ type: LOAD_EVENT.COMPLETE, page });
	}

	/** Whether the read hasn't started. */
	get pending(): boolean {
		return this.state.status === LOAD_STATUS.PENDING;
	}

	/** Whether the read is under way. */
	get running(): boolean {
		return this.state.status === LOAD_STATUS.RUNNING;
	}

	/** Whether the read completed. */
	get completed(): boolean {
		return this.state.status === LOAD_STATUS.COMPLETED;
	}

	/** Returns what the read completed with, or undefined before it completes and after it fails. */
	get page(): T | undefined {
		const state = this.state;
		return state.status === LOAD_STATUS.COMPLETED ? state.page : undefined;
	}

	/** Renders the read's status. */
	render<R>(renders: TLoadRenders<T, R>): R {
		const state = this.state;
		if (state.status === LOAD_STATUS.PENDING) return renders.pending();
		if (state.status === LOAD_STATUS.RUNNING) return renders.running();
		return state.status === LOAD_STATUS.COMPLETED ? renders.completed(state.page) : renders.failed(state.refusal);
	}
}
