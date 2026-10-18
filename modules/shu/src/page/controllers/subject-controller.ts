import type { ReactiveControllerHost } from "lit";
import { type TSubjectEvent, type TSubjectState, INITIAL_SUBJECT, transition } from "../machines/current-subject.js";
import { sharedMachine } from "../root.js";
import { activeEntry, currentSubject } from "../derivations/current-subject.js";
import type { TRecord } from "../domains/current-subject.js";
import { SignalController } from "./signal-controller.js";

/** The current-subject machine: one instance, shared across every component and bundle. A view follows its state and
 *  dispatches a reader's act on it. */
const subjectMachine = sharedMachine<TSubjectState, TSubjectEvent>("currentSubject", INITIAL_SUBJECT, transition);
export const currentSubjectState = subjectMachine.state;
export const dispatchSubjectEvent = (event: TSubjectEvent): TSubjectState => subjectMachine.dispatch(event);

/**
 * SubjectController: the per-view handle to the active record. A view that dims, highlights or follows the active
 * record HOLDS one (`#subject = new SubjectController(this, record => …)`) and receives the record each time what it reads
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
