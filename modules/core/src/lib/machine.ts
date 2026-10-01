/**
 * A machine: one state, moved only by events through one pure transition. The transition returns the next state from
 * the state and the event without I/O, and returns the state unchanged for an event the state doesn't accept. The
 * machine holds its state in a cell and tells each follower every move with the event that made it, so a follower acts
 * on what happened rather than working it out from two states.
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
	/** The only writer: raise an event, and every reader sees the next state and every follower the move. An event that
	 *  doesn't move the state doesn't tell a follower. */
	dispatch(event: E): S {
		const before = this.state.get();
		const after = this.#transition(before, event);
		this.state.set(after);
		if (after !== before) this.#moves.set({ event, before, after });
		return after;
	}
	/** Follow each move until the returned function is called. */
	follow(onMove: (move: TMove<S, E>) => void): () => void {
		return this.#moves.subscribe((move) => {
			if (move) onMove(move);
		});
	}
}

/** A machine held in cells of this process. */
export const machine = <S, E>(initial: S, transition: TTransition<S, E>): Machine<S, E> => new Machine(new Cell(initial), new Cell<TMove<S, E> | null>(null), transition);
