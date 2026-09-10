import { html, css, type TemplateResult } from "lit";
import type { ZodType } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ComboboxSchema, type TComboboxOption } from "../schemas.js";
import { shuBaseStyles } from "./styles.js";

export class ShuCombobox extends ShuElement<typeof ComboboxSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: inline-block; font: inherit; }
		.combo-input {
			border: var(--shu-border-w) solid transparent;
			border-radius: var(--shu-radius);
			background: var(--shu-bg-input);
			color: var(--shu-fg);
			padding: var(--shu-space-1) var(--shu-space-3);
			font: inherit;
			font-size: var(--shu-font-md);
			width: 100%;
			min-height: var(--shu-input-h);
			box-sizing: border-box;
			outline: none;
		}
		.combo-input:focus {
			background: var(--shu-bg-input-focus);
			border-color: var(--shu-border-strong);
		}
		.combo-input::placeholder { color: var(--shu-fg-faded); }
	`,
	];

	private _focusIndex = -1;
	private _input: HTMLInputElement | null = null;
	private _list: HTMLElement | null = null;
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

	static observedHtmlAttributes = ["placeholder", "value", "testid"];

	protected override onAttributeChanged(name: string, _old: string | null, val: string | null): void {
		if (name === "placeholder" && val !== null) {
			this.state = { ...this.state, placeholder: val };
			if (this._input) this._input.placeholder = val;
		}
		if (name === "value" && val !== null) this.setValue(val);
		if (name === "testid" && this._input) this._input.setAttribute("data-testid", val || "");
	}

	/** Set the list of options. The imperative entry point, shu-step-caller builds the element from an HTML
	 *  string and pushes options post-attach, so this must stay public. The reactive `.options` property
	 *  funnels here too. Reconciles the closed display in case the held value only became resolvable now its
	 *  options arrived. */
	setOptions(options: TComboboxOption[]): void {
		const wasReady = this.state.options.length > 0;
		this.state = { ...this.state, options };
		if (this.state.open) this.renderList();
		else this.reconcileClosedDisplay();
		// The readiness marker lives in the lit template; the dropdown is managed imperatively, so a plain options
		// change never re-renders the template. Ask lit to re-render only when readiness flips (rare, catalog load or
		// clear), which keeps the marker current without re-rendering the input during typing churn.
		if (options.length > 0 !== wasReady) this.requestUpdate();
	}

	/** Reactive property: a parent binds `.options=${...}` in its template instead of poking setOptions. */
	set options(options: TComboboxOption[]) {
		this.setOptions(options);
	}
	get options(): TComboboxOption[] {
		return this.state.options;
	}

	/** Set the selected value AND close the dropdown: the imperative entry point. */
	setValue(value: string): void {
		this.applyValue(value, true);
	}

	/** Reactive property: a parent binds `.value=${...}`. A parent re-binds every render, including while
	 *  the user has the dropdown open mid-selection, so the controlled path never closes or stomps an open
	 *  dropdown: while open it updates only state.value (keeping the ✓ correct) and leaves the typed
	 *  filterText alone. The old parent-side `!isOpen` guard lives here now. */
	set value(value: string) {
		if (value === this.state.value) return;
		this.applyValue(value, false);
	}
	get value(): string {
		return this.state.value;
	}

	/** Update the selected value. `close` shuts the dropdown (imperative setValue); the controlled setter
	 *  passes false. An unknown value is shown as-is (shown as given, not defaulted to the first). */
	private applyValue(value: string, close: boolean): void {
		const match = this.state.options.find((o) => o.value === value);
		const keepOpen = this.state.open && !close;
		this.state = { ...this.state, value, ...(keepOpen ? {} : { filterText: match?.label ?? value, open: false }) };
		if (!keepOpen && this._input) this._input.value = this.state.filterText;
		this.renderList();
	}

	/** When options change while closed, refresh the display label for the held value (it may have just become resolvable). */
	private reconcileClosedDisplay(): void {
		const match = this.state.options.find((o) => o.value === this.state.value);
		if (!match || this.state.filterText === match.label) return;
		this.state = { ...this.state, filterText: match.label };
		if (this._input) this._input.value = match.label;
	}

	/** True while the dropdown is open, i.e. the user is mid-selection. Retained for imperative callers;
	 *  the controlled `.value` setter now handles the don't-stomp-open-dropdown reconcile internally. */
	get isOpen(): boolean {
		return this.state.open;
	}

	private get filtered(): TComboboxOption[] {
		const q = this.state.filterText.toLowerCase();
		if (!q) return this.state.options;
		// Rank label hits above value/secondary hits so the typed query surfaces
		// in the visible text first; metadata-only matches still appear, but lower down.
		const labelHits: TComboboxOption[] = [];
		const otherHits: TComboboxOption[] = [];
		for (const o of this.state.options) {
			if (o.label.toLowerCase().includes(q)) labelHits.push(o);
			else if (o.value.toLowerCase().includes(q) || (o.secondary?.toLowerCase().includes(q) ?? false)) otherHits.push(o);
		}
		return [...labelHits, ...otherHits];
	}

	render(): TemplateResult {
		const testId = this.getAttribute("testid") ?? "";
		// Readiness affordance: the control advertises that it holds options to offer, as a stable shadow-attached
		// marker (distinct from the transient dropdown list, which only exists while open). A driver waits on this to
		// know the control is ready before choosing, rather than racing the list render; picking then reads `filtered`
		// off state, so the choice never depends on the ephemeral dropdown being on screen.
		const ready = testId && this.state.options.length > 0 ? html`<span data-testid=${`${testId}-ready`} hidden></span>` : "";
		return html`<input type="text" class="combo-input" placeholder=${this.state.placeholder} .value=${this.state.filterText} autocomplete="off" data-testid=${testId} />${ready}`;
	}

	protected updated(): void {
		if (this._bound) return;
		this._input = this.shadowRoot?.querySelector(".combo-input") as HTMLInputElement | null;
		if (this._input) {
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
		const hasAnyDetails = items.some((o) => o.details);
		const container = document.createElement("div");
		Object.assign(container.style, LIST_STYLE, { display: "flex", padding: "0" });
		const ul = document.createElement("ul");
		ul.setAttribute("role", "listbox");
		const root = this.getRootNode();
		if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
			ul.dataset.comboOwner = root.host.tagName.toLowerCase();
		}
		Object.assign(ul.style, { margin: "0", padding: "0", listStyle: "none", overflowY: "auto", flex: "0 0 auto", maxHeight: "inherit" });
		const detailsPanel = hasAnyDetails ? document.createElement("aside") : null;
		if (detailsPanel) {
			Object.assign(detailsPanel.style, {
				borderLeft: "var(--shu-border-w) solid var(--shu-border)",
				background: "var(--shu-bg-soft)",
				color: "var(--shu-fg)",
				fontSize: "var(--shu-font-sm)",
				fontFamily: "var(--shu-font-family)",
				whiteSpace: "pre-wrap",
				padding: "var(--shu-space-2) var(--shu-space-3)",
				flex: "1 1 auto",
				minWidth: "240px",
				maxWidth: "480px",
				overflowY: "auto",
				maxHeight: "inherit",
			});
			detailsPanel.dataset.role = "details-panel";
		}
		const setDetails = (i: number) => {
			if (!detailsPanel) return;
			detailsPanel.textContent = items[i]?.details ?? "";
		};

		if (items.length > 0) {
			const hostTestId = this.getAttribute("testid");
			let lastGroup: string | undefined;
			for (let i = 0; i < items.length; i++) {
				if (items[i].group && items[i].group !== lastGroup) {
					lastGroup = items[i].group;
					const header = document.createElement("li");
					header.textContent = lastGroup ?? "";
					header.setAttribute("role", "presentation");
					Object.assign(header.style, GROUP_HEADER_STYLE);
					ul.appendChild(header);
				}
				const li = document.createElement("li");
				li.setAttribute("role", "option");
				const isSelected = items[i].value === selectedValue;
				li.setAttribute("aria-selected", String(isSelected));
				li.dataset.value = items[i].value;
				if (hostTestId) li.setAttribute("data-testid", `${hostTestId}-option-${items[i].value}`);
				const mark = document.createElement("span");
				mark.setAttribute("aria-hidden", "true");
				mark.textContent = isSelected ? "✓" : "";
				Object.assign(mark.style, MARK_STYLE);
				const body = document.createElement("div");
				Object.assign(body.style, { flex: "1 1 auto", minWidth: "0" });
				const main = document.createElement("div");
				main.textContent = items[i].label;
				body.appendChild(main);
				if (items[i].secondary) {
					const sec = document.createElement("div");
					sec.textContent = items[i].secondary ?? "";
					Object.assign(sec.style, { color: "var(--shu-fg-muted)", fontSize: "var(--shu-font-sm)", whiteSpace: "nowrap" });
					body.appendChild(sec);
				}
				li.appendChild(mark);
				li.appendChild(body);
				Object.assign(li.style, LI_STYLE);
				if (isSelected) main.style.fontWeight = "600";
				if (i === this._focusIndex) li.style.background = "var(--shu-bg-hover)";
				li.addEventListener("mouseenter", () => {
					li.style.background = "var(--shu-bg-hover)";
					setDetails(i);
				});
				li.addEventListener("mouseleave", () => {
					li.style.background = i === this._focusIndex ? "var(--shu-bg-hover)" : "";
				});
				ul.appendChild(li);
			}
			setDetails(this._focusIndex >= 0 ? this._focusIndex : 0);
		} else {
			const li = document.createElement("li");
			li.textContent = "No matches";
			Object.assign(li.style, {
				...LI_STYLE,
				color: "var(--shu-fg-faded)",
				fontStyle: "italic",
				cursor: "default",
			});
			ul.appendChild(li);
		}

		// Pick on mousedown (so the input's blur listener doesn't close the
		// dropdown before the click fires) AND on click (Playwright synthesises
		// click but its mousedown sequence is sometimes unreliable in shadow-DOM
		// adjacent contexts; clicking is the real interaction).
		const handlePick = (e: Event) => {
			e.preventDefault();
			const li = (e.target as HTMLElement).closest("li[data-value]") as HTMLLIElement | null;
			if (!li) return;
			const opt = this.state.options.find((o) => o.value === li.dataset.value);
			if (opt) this.pick(opt);
		};
		ul.addEventListener("mousedown", handlePick);
		ul.addEventListener("click", handlePick);

		container.appendChild(ul);
		if (detailsPanel) container.appendChild(detailsPanel);

		const rect = this._input.getBoundingClientRect();
		container.style.left = `${rect.left}px`;
		const listWidth = Math.max(rect.width, 200);
		ul.style.width = `${listWidth}px`;
		document.body.appendChild(container);
		// Flip the dropdown above the input when there isn't room below it (e.g. the actions bar pinned to the bottom of
		// the viewport) so the options never run off the bottom edge; otherwise open downward as usual. Measured after
		// append, so `offsetHeight` reflects the real list height (capped by LIST_STYLE max-height).
		const spaceBelow = window.innerHeight - rect.bottom;
		const listHeight = container.offsetHeight;
		container.style.top = spaceBelow < listHeight && rect.top > spaceBelow ? `${Math.max(0, rect.top - listHeight)}px` : `${rect.bottom}px`;
		this._list = container;

		if (this._focusIndex >= 0 && this._focusIndex < items.length) {
			// Headers are non-selectable <li>s interleaved with option <li>s, so the
			// focused option's DOM index != _focusIndex. Scroll by data-value instead.
			ul.querySelector(`li[data-value="${CSS.escape(items[this._focusIndex].value)}"]`)?.scrollIntoView({ block: "nearest" });
		}
	}

	protected override onDisconnected(): void {
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
			// Re-read input.value before computing filtered: Playwright's fill() sets
			// the value but the input event may have run before this state was committed;
			// reading the live DOM value avoids a stale-state Enter no-op.
			if (input.value !== this.state.filterText) {
				this.state = { ...this.state, filterText: input.value, open: true };
			}
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
				} else if (items.length > 1) {
					// Multiple substring matches: prefer an exact value or label match
					// before giving up. Without this an Enter on a fully-typed unique
					// stepName silently no-ops when an unrelated option happens to
					// substring-match too.
					const q = this.state.filterText;
					const exact = items.find((o) => o.value === q || o.label === q);
					if (exact) this.pick(exact);
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
				const match = this.state.options.find((o) => o.value === this.state.value);
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

// Inline styles for the dropdown rendered in document.body (escapes overflow:hidden ancestors).
// The token vars resolve because the SPA boot installs SHU_TOKENS at document level via
// `installShuTokens()`; otherwise the dropdown would fall back to the browser default colours.
const LIST_STYLE: Partial<CSSStyleDeclaration> = {
	position: "fixed",
	zIndex: "10000",
	margin: "0",
	padding: "0",
	listStyle: "none",
	background: "var(--shu-bg)",
	color: "var(--shu-fg)",
	border: "var(--shu-border-w) solid var(--shu-border)",
	borderRadius: "var(--shu-radius)",
	boxShadow: "0 2px 8px var(--shu-shadow)",
	maxHeight: "240px",
	overflowY: "auto",
	overflowX: "auto",
	fontFamily: "inherit",
	fontSize: "var(--shu-font-md)",
	boxSizing: "border-box",
};

const LI_STYLE: Partial<CSSStyleDeclaration> = {
	display: "flex",
	alignItems: "baseline",
	gap: "var(--shu-space-2)",
	padding: "var(--shu-space-1) var(--shu-space-3)",
	cursor: "pointer",
	whiteSpace: "nowrap",
};

// Fixed-width tick column so the selected option's ✓ aligns and unselected rows stay flush.
const MARK_STYLE: Partial<CSSStyleDeclaration> = {
	flex: "0 0 1.1em",
	textAlign: "center",
	color: "var(--shu-fg)",
};

const GROUP_HEADER_STYLE: Partial<CSSStyleDeclaration> = {
	padding: "var(--shu-space-1) var(--shu-space-3)",
	fontSize: "var(--shu-font-xs)",
	fontWeight: "600",
	letterSpacing: "0.05em",
	color: "var(--shu-fg-faded)",
	background: "var(--shu-bg-soft)",
	cursor: "default",
	userSelect: "none",
};
