/**
 * A combobox's list, held in the combobox machine (`page/machines/combobox.ts`): whether it is open, the text that filters
 * its options, and the option the keys focus. The view draws again at each move.
 */
import type { ReactiveControllerHost } from "lit";
import { machine, type Machine } from "@haibun/core/lib/machines/machine.js";
import { COMBO_EVENT, COMBO_STATUS, INITIAL_COMBO, UNFOCUSED, comboTransition, type TComboEvent, type TComboState } from "../machines/combobox.js";

export class ComboboxController {
	readonly #machine: Machine<TComboState, TComboEvent> = machine<TComboState, TComboEvent>(INITIAL_COMBO, comboTransition);

	constructor(host: ReactiveControllerHost) {
		this.#machine.follow(() => host.requestUpdate());
	}

	get #state(): TComboState {
		return this.#machine.state.get();
	}

	/** Whether the list is open. */
	get open(): boolean {
		return this.#state.status === COMBO_STATUS.OPEN;
	}

	/** The text that filters the open list's options. Throws for a closed list. */
	get filter(): string {
		const state = this.#state;
		if (state.status !== COMBO_STATUS.OPEN) throw new Error("a closed combobox list doesn't hold a filter");
		return state.filter;
	}

	/** The index of the option the keys focus in the open list, or undefined where the keys haven't moved it. */
	get focus(): number | undefined {
		const state = this.#state;
		return state.status === COMBO_STATUS.OPEN && state.focus !== UNFOCUSED ? state.focus : undefined;
	}

	/** Opens the list on every option. */
	offer(): void {
		this.#machine.dispatch({ type: COMBO_EVENT.OFFER });
	}

	/** Opens the list on the options `text` matches. */
	filterBy(text: string): void {
		this.#machine.dispatch({ type: COMBO_EVENT.FILTER, text });
	}

	/** Moves the focus by `by` among the `offered` options the list shows. */
	move(by: 1 | -1, offered: number): void {
		this.#machine.dispatch({ type: COMBO_EVENT.MOVE, by, offered });
	}

	/** Closes the list. */
	close(): void {
		this.#machine.dispatch({ type: COMBO_EVENT.CLOSE });
	}
}
