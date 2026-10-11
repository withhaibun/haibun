/**
 * A read a view shows, held in the load machine (`page/machines/load.ts`): a run starts the read, and its end completes
 * the machine with what it read, or fails it with the refusal (`page/derivations/refusal.ts`). The view draws again at each
 * move, and renders each status through `render`.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { machine, type Machine } from "@haibun/core/lib/machine.js";
import { INITIAL_LOAD, LOAD_EVENT, LOAD_STATUS, loadTransition, type TLoadEvent, type TLoadState } from "../machines/load.js";
import { refusalOf } from "../derivations/refusal.js";
import type { TPageRefusal } from "../domains/refusal.js";

/** What a view renders for each status of a read. */
export type TLoadRenders<T, R> = { pending: () => R; running: () => R; completed: (page: T) => R; failed: (refusal: TPageRefusal) => R };

export class LoadController<T> implements ReactiveController {
	readonly #read: () => Promise<T>;
	readonly #machine: Machine<TLoadState<T>, TLoadEvent<T>> = machine<TLoadState<T>, TLoadEvent<T>>(INITIAL_LOAD, loadTransition);
	/** The count of reads started, so a read that a later read replaced doesn't end the later read. */
	#started = 0;

	constructor(host: ReactiveControllerHost, read: () => Promise<T>) {
		this.#read = read;
		host.addController(this);
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
		try {
			const page = await this.#read();
			if (started === this.#started) this.#machine.dispatch({ type: LOAD_EVENT.COMPLETE, page });
		} catch (err) {
			if (started === this.#started) this.#machine.dispatch({ type: LOAD_EVENT.FAIL, refusal: refusalOf(err) });
		}
	}

	/** Renders the read's status. */
	render<R>(renders: TLoadRenders<T, R>): R {
		const state = this.state;
		if (state.status === LOAD_STATUS.PENDING) return renders.pending();
		if (state.status === LOAD_STATUS.RUNNING) return renders.running();
		return state.status === LOAD_STATUS.COMPLETED ? renders.completed(state.page) : renders.failed(state.refusal);
	}
}
