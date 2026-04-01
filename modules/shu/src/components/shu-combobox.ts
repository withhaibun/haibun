import type { ZodType } from "zod";
import { ShuElement } from "./shu-element.js";
import { ComboboxSchema, type TComboboxOption } from "../schemas.js";
import { escAttr } from "../util.js";

export class ShuCombobox extends ShuElement<typeof ComboboxSchema> {
	private _focusIndex = -1;
	private _input: HTMLInputElement | null = null;
	private _list: HTMLUListElement | null = null;
	private _bound = false;
	private _valueSchema: ZodType | null = null;
	private _blurTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super(ComboboxSchema, {
			value: "",
			options: [],
			placeholder: "",
			filterText: "",
			open: false,
		});
	}

	/** Set a Zod schema to validate selected values against. */
	setValueSchema(schema: ZodType): void {
		this._valueSchema = schema;
	}

	static get observedAttributes(): string[] {
		return ["placeholder", "value", "testid"];
	}

	attributeChangedCallback(
		name: string,
		_old: string | null,
		val: string | null,
	): void {
		if (name === "placeholder" && val !== null) {
			this.state = { ...this.state, placeholder: val };
			if (this._input) this._input.placeholder = val;
		}
		if (name === "value" && val !== null) this.setValue(val);
		if (name === "testid" && this._input)
			this._input.setAttribute("data-testid", val || "");
	}

	/** Set the list of options. Safe to call before or after connectedCallback. */
	setOptions(options: TComboboxOption[]): void {
		this.state = { ...this.state, options };
		if (this.state.open) this.renderList();
	}

	/** Set the selected value, updating the display. */
	setValue(value: string): void {
		const match = this.state.options.find((o) => o.value === value);
		this.state = {
			...this.state,
			value,
			filterText: match?.label ?? value,
			open: false,
		};
		if (this._input) this._input.value = this.state.filterText;
		this.renderList();
	}

	get value(): string {
		return this.state.value;
	}

	private get filtered(): TComboboxOption[] {
		const q = this.state.filterText.toLowerCase();
		if (!q) return this.state.options;
		return this.state.options.filter(
			(o) =>
				o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
		);
	}

	protected render(): void {
		if (!this.shadowRoot) return;

		if (!this._bound) {
			const testId = this.getAttribute("testid");
			this.shadowRoot.innerHTML = `${this.css(STYLES)}
<input type="text" class="combo-input" placeholder="${escAttr(this.state.placeholder)}" value="${escAttr(this.state.filterText)}" autocomplete="off"${testId ? ` data-testid="${escAttr(testId)}"` : ""} />`;
			this._input = this.shadowRoot.querySelector(".combo-input");
			this.bindEvents();
			this._bound = true;
		}
	}

	private renderList(): void {
		this._list?.remove();
		this._list = null;

		if (!this.state.open || !this._input) return;

		const items = this.filtered;
		const selectedValue = this.state.value;
		const ul = document.createElement("ul");
		ul.setAttribute("role", "listbox");
		Object.assign(ul.style, LIST_STYLE);

		if (items.length > 0) {
			for (let i = 0; i < items.length; i++) {
				const li = document.createElement("li");
				li.setAttribute("role", "option");
				li.dataset.value = items[i].value;
				li.textContent = items[i].label;
				Object.assign(li.style, LI_STYLE);
				if (items[i].value === selectedValue) li.style.fontWeight = "600";
				if (i === this._focusIndex) li.style.background = "#e8f0fe";
				li.addEventListener("mouseenter", () => {
					li.style.background = "#e8f0fe";
				});
				li.addEventListener("mouseleave", () => {
					li.style.background = i === this._focusIndex ? "#e8f0fe" : "";
				});
				ul.appendChild(li);
			}
		} else {
			const li = document.createElement("li");
			li.textContent = "No matches";
			Object.assign(li.style, {
				...LI_STYLE,
				color: "#999",
				fontStyle: "italic",
				cursor: "default",
			});
			ul.appendChild(li);
		}

		ul.addEventListener("mousedown", (e) => {
			e.preventDefault();
			const li = (e.target as HTMLElement).closest(
				"li[data-value]",
			) as HTMLLIElement | null;
			if (!li) return;
			const opt = this.state.options.find((o) => o.value === li.dataset.value);
			if (opt) this.pick(opt);
		});

		// Position in document.body to escape overflow:hidden ancestors
		const rect = this._input.getBoundingClientRect();
		ul.style.top = `${rect.bottom}px`;
		ul.style.left = `${rect.left}px`;
		ul.style.width = `${Math.max(rect.width, 200)}px`;
		document.body.appendChild(ul);
		this._list = ul;

		if (this._focusIndex >= 0 && this._focusIndex < ul.children.length) {
			(ul.children[this._focusIndex] as HTMLElement).scrollIntoView({
				block: "nearest",
			});
		}
	}

	disconnectedCallback(): void {
		if (this._blurTimeout) clearTimeout(this._blurTimeout);
		this._list?.remove();
		this._list = null;
	}

	private close(): void {
		if (!this.state.open) return;
		this.state = { ...this.state, open: false };
		this._list?.remove();
		this._list = null;
	}

	private bindEvents(): void {
		const input = this._input;
		if (!input) return;

		input.addEventListener("focus", () => {
			input.select();
			this.state = { ...this.state, filterText: "", open: true };
			this._focusIndex = -1;
			this.renderList();
		});

		input.addEventListener("input", () => {
			this._focusIndex = -1;
			this.state = {
				...this.state,
				filterText: input.value,
				value: "",
				open: true,
			};
			this.renderList();
		});

		input.addEventListener("keydown", (e) => {
			const items = this.filtered;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this._focusIndex = Math.min(this._focusIndex + 1, items.length - 1);
				this.renderList();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this._focusIndex = Math.max(this._focusIndex - 1, 0);
				this.renderList();
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (this._focusIndex >= 0 && this._focusIndex < items.length) {
					this.pick(items[this._focusIndex]);
				} else if (items.length === 1) {
					this.pick(items[0]);
				}
			} else if (e.key === "Escape") {
				this.close();
				input.blur();
			}
		});

		input.addEventListener("blur", () => {
			if (this._blurTimeout) clearTimeout(this._blurTimeout);
			this._blurTimeout = setTimeout(() => {
				this._blurTimeout = null;
				this.close();
				const match = this.state.options.find(
					(o) => o.value === this.state.value,
				);
				input.value = match?.label ?? this.state.value;
				this.state = { ...this.state, filterText: input.value };
			}, 150);
		});
	}

	private pick(option: TComboboxOption): void {
		if (this._valueSchema) {
			const result = this._valueSchema.safeParse(option.value);
			if (!result.success) return;
		}
		this._focusIndex = -1;
		this.state = {
			...this.state,
			value: option.value,
			filterText: option.label,
			open: false,
		};
		if (this._input) this._input.value = option.label;
		this._list?.remove();
		this._list = null;
		this.dispatchEvent(
			new CustomEvent("combo-change", {
				detail: { value: option.value, label: option.label },
				bubbles: true,
				composed: true,
			}),
		);
	}
}

const STYLES = `
:host { display: inline-block; font: inherit; }
.combo-input {
  border: none; border-radius: 3px; background: #f0f0f0;
  padding: 2px 6px; font: inherit; width: 100%; height: 100%; box-sizing: border-box;
  outline: none;
}
.combo-input:focus { background: #e8e8e8; }
`;

// Inline styles for the dropdown rendered in document.body (escapes overflow:hidden ancestors)
const LIST_STYLE: Partial<CSSStyleDeclaration> = {
	position: "fixed",
	zIndex: "10000",
	margin: "0",
	padding: "0",
	listStyle: "none",
	background: "#fff",
	border: "none",
	boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
	maxHeight: "200px",
	overflowY: "auto",
	overflowX: "auto",
	fontFamily: "inherit",
	fontSize: "inherit",
	boxSizing: "border-box",
};

const LI_STYLE: Partial<CSSStyleDeclaration> = {
	padding: "2px 6px",
	cursor: "pointer",
	whiteSpace: "nowrap",
};
