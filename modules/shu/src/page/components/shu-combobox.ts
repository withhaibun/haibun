/**
 * <shu-combobox>: a text input that offers options, filters them by what a reader types, and holds the one a reader picks.
 * The list renders in the combobox's own shadow root as a manual popover, so it shows in the top layer above a container
 * that clips, and a click on it lands within the view that holds the combobox. A pick dispatches `combo-change`.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ComboboxSchema, type TComboboxOption } from "../../schemas.js";
import { shuBaseStyles } from "./styles.js";
import { revealInDocument } from "../../reveal.js";
import { ClockController } from "../controllers/clock-controller.js";
import { ComboboxController } from "../controllers/combobox-controller.js";

/** How long after the input loses focus the list closes, so a click on an option lands before it closes, and the name of
 *  that delay. */
const BLUR_MS = 150;
const BLUR = "blur";
/** The least width of the list, which is as wide as the input where the input is wider. */
const LIST_MIN_WIDTH = 200;

export class ShuCombobox extends ShuElement<typeof ComboboxSchema> {
	/** A control doesn't contribute to the Kihan's context, since it isn't a view of data. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: inline-block; font: inherit; }
			.combo-input { font: inherit; font-size: var(--shu-font-md); width: 100%; min-height: var(--shu-input-h); box-sizing: border-box; }
			.list { position: fixed; inset: auto; margin: 0; padding: 0; display: flex; max-height: 240px; background: var(--shu-bg); color: var(--shu-fg); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); box-shadow: 0 2px 8px var(--shu-shadow); font-size: var(--shu-font-md); box-sizing: border-box; overflow: auto; }
			ul { margin: 0; padding: 0; list-style: none; overflow-y: auto; flex: 0 0 auto; max-height: inherit; }
			li { display: flex; align-items: baseline; gap: var(--shu-space-2); padding: var(--shu-space-1) var(--shu-space-3); cursor: pointer; white-space: nowrap; }
			li.focused, li[role="option"]:hover { background: var(--shu-bg-hover); }
			li.group { font-size: var(--shu-font-xs); font-weight: 600; letter-spacing: 0.05em; color: var(--shu-fg-faded); background: var(--shu-bg-soft); cursor: default; user-select: none; }
			li.unmatched { color: var(--shu-fg-faded); font-style: italic; cursor: default; }
			.mark { flex: 0 0 1.1em; text-align: center; }
			.option { flex: 1 1 auto; min-width: 0; }
			.chosen { font-weight: 600; }
			.secondary { color: var(--shu-fg-muted); font-size: var(--shu-font-sm); white-space: nowrap; }
			aside { border-left: var(--shu-border-w) solid var(--shu-border); background: var(--shu-bg-soft); font-size: var(--shu-font-sm); white-space: pre-wrap; padding: var(--shu-space-2) var(--shu-space-3); flex: 1 1 auto; min-width: 240px; max-width: 480px; overflow-y: auto; max-height: inherit; }
		`,
	];

	static observedHtmlAttributes = ["placeholder", "value", "testid"];

	readonly #clock = new ClockController(this);
	readonly #list = new ComboboxController(this);
	/** The option the pointer is over, whose details the list shows. */
	@state() private accessor hovered: number | undefined = undefined;

	constructor() {
		super(ComboboxSchema, { value: "", options: [], placeholder: "", shown: "" });
	}

	protected override onAttributeChanged(name: string, _old: string | null, val: string | null): void {
		if (val === null) return;
		if (name === "placeholder") this.setState({ placeholder: val });
		if (name === "value") this.setValue(val);
	}

	/** What the control shows for the value it holds, where its holder states it, in place of the chosen option's label. */
	set shown(text: string) {
		this.setState({ shown: text });
	}
	get shown(): string {
		return this.state.shown;
	}

	/** The options the control offers. A parent binds `.options`, and a view that builds the element calls `setOptions`. */
	setOptions(options: TComboboxOption[]): void {
		this.setState({ options });
	}
	set options(options: TComboboxOption[]) {
		this.setOptions(options);
	}
	get options(): TComboboxOption[] {
		return this.state.options;
	}

	/** Holds `value` and closes the list. */
	setValue(value: string): void {
		this.setState({ value });
		this.#list.close();
	}

	/** Holds `value`. A parent binds `.value` at each render, including while a reader picks, so the bound value leaves an
	 *  open list open, and its filter as the reader typed it. */
	set value(value: string) {
		if (value !== this.state.value) this.setState({ value });
	}
	get value(): string {
		return this.state.value;
	}

	/** Enters `text` in the input, as the reader typing it does, which filters the options. */
	enter(text: string): void {
		this.#onInput(text);
	}

	/** What the closed control shows: the text its holder states, else the chosen option's label, else the value itself. */
	get #held(): string {
		if (this.state.shown !== "") return this.state.shown;
		const chosen = this.state.options.find((o) => o.value === this.state.value);
		return chosen === undefined ? this.state.value : chosen.label;
	}

	/** The options the open list offers for its filter: those whose label holds the text, then those whose value or
	 *  secondary text holds it. */
	get #offered(): TComboboxOption[] {
		const q = this.#list.filter.toLowerCase();
		if (q === "") return this.state.options;
		const labelled = this.state.options.filter((o) => o.label.toLowerCase().includes(q));
		const other = this.state.options.filter((o) => !o.label.toLowerCase().includes(q) && (o.value.toLowerCase().includes(q) || o.secondary?.toLowerCase().includes(q) === true));
		return [...labelled, ...other];
	}

	#offer = (e: Event): void => {
		if (this.#list.open) return;
		(e.target as HTMLInputElement).select();
		this.hovered = undefined;
		this.#list.offer();
	};

	#onInput(text: string): void {
		this.setState({ value: "" });
		this.#list.filterBy(text);
	}

	#onKeydown = (e: KeyboardEvent): void => {
		const input = e.target as HTMLInputElement;
		// A driver that fills the input can press a key before the input event commits its text.
		if (!this.#list.open || input.value !== this.#list.filter) this.#list.filterBy(input.value);
		const offered = this.#offered;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			this.#list.move(e.key === "ArrowDown" ? 1 : -1, offered.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const focus = this.#list.focus;
			const q = this.#list.filter;
			// One offered option, or the one whose value or label the reader typed whole among several, is the pick.
			const picked = focus !== undefined ? offered[focus] : offered.length === 1 ? offered[0] : offered.find((o) => o.value === q || o.label === q);
			if (picked !== undefined) this.#pick(picked);
		} else if (e.key === "Escape") {
			this.#list.close();
			input.blur();
		}
	};

	#onBlur = (): void => {
		this.#clock.trailing(BLUR, BLUR_MS, () => this.#list.close());
	};

	/** A press on an option picks it: on mousedown, so the input's blur doesn't close the list first, and on click, which a
	 *  driver sends without a reliable mousedown. */
	#onPress = (e: Event): void => {
		e.preventDefault();
		const item = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-value]");
		if (item === null) return;
		const option = this.state.options.find((o) => o.value === item.dataset.value);
		if (option === undefined) throw new Error(`the combobox offers ${item.dataset.value}, which its options don't hold`);
		this.#pick(option);
	};

	#pick(option: TComboboxOption): void {
		this.setState({ value: option.value });
		this.#list.close();
		this.dispatchEvent(new CustomEvent("combo-change", { detail: { value: option.value, label: option.label }, bubbles: true, composed: true }));
	}

	protected override onDisconnected(): void {
		this.#list.close();
	}

	/** Shows the open list as a popover, placed under the input, or over it where the viewport doesn't have room below, and
	 *  brings the focused option into view. */
	protected override updated(): void {
		const list = this.shadowRoot?.querySelector<HTMLElement>(".list");
		const input = this.shadowRoot?.querySelector<HTMLInputElement>(".combo-input");
		if (list === null || list === undefined || input === null || input === undefined) return;
		// jsdom doesn't implement popover.
		if (typeof list.showPopover === "function" && !list.matches(":popover-open")) list.showPopover();
		const rect = input.getBoundingClientRect();
		list.style.left = `${rect.left}px`;
		list.style.minWidth = `${Math.max(rect.width, LIST_MIN_WIDTH)}px`;
		const below = window.innerHeight - rect.bottom;
		list.style.top = below < list.offsetHeight && rect.top > below ? `${Math.max(0, rect.top - list.offsetHeight)}px` : `${rect.bottom}px`;
		const focused = list.querySelector("li.focused");
		if (focused !== null) revealInDocument(focused, { block: "nearest" });
	}

	private renderList(): TemplateResult {
		const offered = this.#offered;
		const testId = this.getAttribute("testid");
		const focus = this.#list.focus;
		const detailed = offered.some((o) => o.details !== undefined);
		const shownDetails = offered[this.hovered ?? focus ?? 0]?.details;
		let group: string | undefined;
		const items = offered.flatMap((o, i) => {
			const header = o.group !== undefined && o.group !== group ? html`<li class="group" role="presentation">${o.group}</li>` : nothing;
			group = o.group;
			const chosen = o.value === this.state.value;
			const option = html`<li role="option" aria-selected=${String(chosen)} data-value=${o.value} data-testid=${testId === null ? nothing : `${testId}-option-${o.value}`} class=${i === focus ? "focused" : ""}
				@mouseenter=${() => (this.hovered = i)}><span class="mark" aria-hidden="true">${chosen ? "✓" : ""}</span><div class="option"><div class=${chosen ? "chosen" : ""}>${o.label}</div>${o.secondary === undefined ? nothing : html`<div class="secondary">${o.secondary}</div>`}</div></li>`;
			return [header, option];
		});
		return html`<div class="list" popover="manual">
			<ul role="listbox" @mousedown=${this.#onPress} @click=${this.#onPress}>${offered.length === 0 ? html`<li class="unmatched">The text doesn't match an option</li>` : items}</ul>
			${detailed ? html`<aside data-role="details-panel">${shownDetails}</aside>` : nothing}
		</div>`;
	}

	render(): TemplateResult {
		const testId = this.getAttribute("testid");
		const open = this.#list.open;
		// The control states that it holds options to offer, as a marker a driver waits on before it picks, rather than on
		// the list, which shows only while open.
		const ready = testId !== null && this.state.options.length > 0 ? html`<span data-testid=${`${testId}-ready`} hidden></span>` : nothing;
		return html`<input type="text" class="combo-input" placeholder=${this.state.placeholder} .value=${open ? this.#list.filter : this.#held} autocomplete="off" data-testid=${testId === null ? nothing : testId}
				@focus=${this.#offer} @pointerdown=${this.#offer} @input=${(e: Event) => this.#onInput((e.target as HTMLInputElement).value)} @keydown=${this.#onKeydown} @blur=${this.#onBlur} />${ready}${open ? this.renderList() : nothing}`;
	}
}

defineElement(SHU_TAG.COMBOBOX, ShuCombobox);
