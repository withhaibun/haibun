import type { ReactiveControllerHost } from "lit";
import { activeEntry, currentSubject, currentSubjectState, type TRecord, type TSubjectState } from "../current-subject.js";
import { SignalController } from "./signal-controller.js";

/**
 * SubjectController: the per-view handle to the active record. A view that dims, highlights or follows the active
 * record HOLDS one (`#subject = new SubjectController(this, record => …)`) and is told the record each time what it reads
 * changes. See ./index.ts for the pattern; data-access.test.ts enforces it.
 */
export class SubjectController extends SignalController<TSubjectState> {
	/** `reads` is what the view shows of the state, the active entry unless the view reads more. */
	constructor(host: ReactiveControllerHost, onChange: (record: TRecord | null, state: TSubjectState) => void, reads: (state: TSubjectState) => unknown = activeEntry) {
		super(host, currentSubjectState, (state) => onChange(currentSubject(state), state), reads);
	}

	/** The active record now. */
	get record(): TRecord | null {
		return currentSubject(this.state);
	}
}
