import type { ReactiveController, ReactiveControllerHost } from "lit";
import { activeEntry, currentSubject, currentSubjectState, type TRecord, type TSubjectState } from "../current-subject.js";

/**
 * SubjectController: the per-view handle to the active record. A view that dims, highlights or follows the active
 * record HOLDS one (`#subject = new SubjectController(this, record => …)`) and is told the record each time it changes;
 * it never reads the machine's cell itself. The view gets the current answer as soon as it connects, so a view that
 * boots after the reader chose something shows the choice, and every later change by the same path. See ./index.ts
 * for the pattern; data-access.test.ts enforces it.
 */
export class SubjectController implements ReactiveController {
	private readonly host: ReactiveControllerHost;
	private readonly onChange: (record: TRecord | null, state: TSubjectState) => void;
	private unsubscribe: (() => void) | null = null;
	private last: string | undefined;

	constructor(host: ReactiveControllerHost, onChange: (record: TRecord | null, state: TSubjectState) => void) {
		this.host = host;
		this.onChange = onChange;
		host.addController(this);
	}

	hostConnected(): void {
		this.relay(currentSubjectState.get());
		this.unsubscribe = currentSubjectState.subscribe((state) => this.relay(state));
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.last = undefined;
	}

	/** The active record now. */
	get record(): TRecord | null {
		return currentSubject(currentSubjectState.get());
	}

	/** The whole state now, for a view that reads more than the active record, such as the bundle an ask carries. */
	get state(): TSubjectState {
		return currentSubjectState.get();
	}

	/** Tell the host the active record, once per change of the active entry: its record, its seqPath or its bundle. A
	 *  state change that leaves the active entry as it was is not a change of what the view shows. */
	private relay(state: TSubjectState): void {
		const record = currentSubject(state);
		const key = JSON.stringify(activeEntry(state));
		if (key === this.last) return;
		this.last = key;
		this.onChange(record, state);
		this.host.requestUpdate();
	}
}
