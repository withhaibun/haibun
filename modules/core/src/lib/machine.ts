/**
 * A Machine holds one state. An event changes the state only through one pure transition. The transition computes the
 * next state from the state and the event without I/O. It returns the state unchanged for an event the state doesn't
 * accept. The machine holds its state in a cell. It sends each follower every move with the event that caused it, so a
 * follower acts on the event and doesn't derive it by comparing two states.
 */
import { Cell, type ICell } from "./cell.js";

/** The next state from a state and an event. */
export type TTransition<S, E> = (state: S, event: E) => S;

/** One move of a machine: the event, and the state before and after it. */
export type TMove<S, E> = { event: E; before: S; after: S };

export class Machine<S, E> {
	readonly state: ICell<S>;
	readonly #moves: ICell<TMove<S, E> | null>;
	readonly #transition: TTransition<S, E>;
	constructor(state: ICell<S>, moves: ICell<TMove<S, E> | null>, transition: TTransition<S, E>) {
		this.state = state;
		this.#moves = moves;
		this.#transition = transition;
	}
	/** The only writer of the state. Sets the state the transition returns for the event, sends the move to every follower
	 *  and returns the new state. dispatch doesn't send a move for an event that leaves the state unchanged. */
	dispatch(event: E): S {
		const before = this.state.get();
		const after = this.#transition(before, event);
		this.state.set(after);
		if (after !== before) this.#moves.set({ event, before, after });
		return after;
	}
	/** Calls onMove with each move until the returned function is called. */
	follow(onMove: (move: TMove<S, E>) => void): () => void {
		return this.#moves.subscribe((move) => {
			if (move) onMove(move);
		});
	}
}

/** Creates a machine whose state and moves are held in cells of this process. */
export const machine = <S, E>(initial: S, transition: TTransition<S, E>): Machine<S, E> => new Machine(new Cell(initial), new Cell<TMove<S, E> | null>(null), transition);
