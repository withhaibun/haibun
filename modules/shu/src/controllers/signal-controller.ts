import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { SharedSignal } from "../signals.js";

/**
 * SignalController: a view's handle to one page-level machine held in a SharedSignal. The view holds one per machine it
 * reads and is told the state each time what it reads changes. The view gets the state as soon as it connects, so a
 * view that mounts after the machine moved shows where it is. The view never subscribes to the signal itself.
 */
export class SignalController<T> implements ReactiveController {
	private readonly host: ReactiveControllerHost;
	private readonly signal: SharedSignal<T>;
	private readonly onChange: (state: T) => void;
	private readonly reads: (state: T) => unknown;
	private unsubscribe: (() => void) | null = null;
	private last: string | undefined;

	/** `reads` is what the view shows of the state, the whole state unless the view reads less. */
	constructor(host: ReactiveControllerHost, signal: SharedSignal<T>, onChange: (state: T) => void, reads: (state: T) => unknown = (state) => state) {
		this.host = host;
		this.signal = signal;
		this.onChange = onChange;
		this.reads = reads;
		host.addController(this);
	}

	hostConnected(): void {
		this.relay(this.signal.get());
		this.unsubscribe = this.signal.subscribe((state) => this.relay(state));
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.last = undefined;
	}

	/** The state now. */
	get state(): T {
		return this.signal.get();
	}

	/** Tell the host the state, once per change of what the view reads. A state change that leaves that as it was is not
	 *  a change of what the view shows. */
	private relay(state: T): void {
		const key = JSON.stringify(this.reads(state));
		if (key === this.last) return;
		this.last = key;
		this.onChange(state);
		this.host.requestUpdate();
	}
}
