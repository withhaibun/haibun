import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { SharedSignal } from "../signals.js";

/**
 * SignalController: a view's handle to one page-level machine held in a SharedSignal. The view holds one per machine it
 * reads and is told the state, and the state it last told, each time what it reads changes. The view gets the state as
 * soon as it connects, so a view that mounts after the machine moved shows where it is. The view never subscribes to the
 * signal itself.
 */
export class SignalController<T> implements ReactiveController {
	private readonly host: ReactiveControllerHost;
	private readonly signal: SharedSignal<T>;
	private readonly onChange: (state: T, before: T | undefined) => void;
	private readonly reads: ((state: T) => unknown) | undefined;
	private unsubscribe: (() => void) | null = null;
	/** The state last told, and the key of what the view read of it. */
	private told: { state: T; key: string } | undefined;

	/** `reads` is what the view shows of the state. Without it the view shows the whole state, and every new state is a
	 *  change, since the signal holds a new state only for an event that changed it. */
	constructor(host: ReactiveControllerHost, signal: SharedSignal<T>, onChange: (state: T, before: T | undefined) => void, reads?: (state: T) => unknown) {
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
		this.told = undefined;
	}

	/** The state now. */
	get state(): T {
		return this.signal.get();
	}

	/** Tell the host the state, once per change of what the view reads. A state change that leaves that as it was is not
	 *  a change of what the view shows. */
	private relay(state: T): void {
		const key = this.reads ? JSON.stringify(this.reads(state)) : "";
		const before = this.told;
		if (before && (this.reads ? key === before.key : state === before.state)) return;
		this.told = { state, key };
		this.onChange(state, before?.state);
		this.host.requestUpdate();
	}
}
