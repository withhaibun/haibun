/**
 * <shu-field> — one named control: a name and the control it names, on one line, centred against each other.
 *
 * Every settings row is a run of these, so a select, a checkbox and a text box sit on the same centre line whatever
 * their intrinsic heights are — the alignment is decided once here rather than by each row's own markup. `trailing`
 * puts the name after the control, which is where a checkbox's name belongs.
 *
 * It owns nothing: the control is the host's, slotted in, keeping its own id, value and events.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";

export class ShuField extends ShuElement<z.ZodType> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static properties = {
		label: { attribute: true },
		trailing: { attribute: true, type: Boolean },
	};

	/** What the control is called. */
	declare label: string;
	/** Put the name after the control — the reading a checkbox takes. */
	declare trailing: boolean;

	static styles = [
		shuBaseStyles,
		css`
			:host { display: inline-flex; align-items: center; gap: var(--shu-space-1); font-size: var(--shu-font-sm); color: var(--shu-fg); }
			.name { color: var(--shu-fg-muted); white-space: nowrap; }
			/* The slot carries no box of its own, so several slotted controls are each a flex item here and take the gap
			   between them — a name, its box and its button read as three things, not one run. */
			slot { display: contents; }
			/* The control keeps its own look; only its alignment is decided here, so a row of fields shares one centre line. */
			::slotted(*) { vertical-align: middle; margin: 0; }
		`,
	];

	constructor() {
		super(z.object({}), {});
		this.label = "";
		this.trailing = false;
	}

	render(): TemplateResult {
		// The name is a real label for its control: pressing it acts on the control, and assistive tech announces the two
		// together. A <label for> cannot reach across the shadow boundary to a slotted control, so the association is made
		// the way that does work — the control carries the name as its accessible name, and the name forwards a press.
		const name = html`<span class="name" @click=${this.pressControl}>${this.label}</span>`;
		return html`${this.trailing ? html`<slot @slotchange=${this.nameControl}></slot>${name}` : html`${name}<slot @slotchange=${this.nameControl}></slot>`}`;
	}

	/** The slotted control this field names: the first form control in the slot. */
	private control(): HTMLElement | undefined {
		const slot = this.shadowRoot?.querySelector("slot");
		return slot?.assignedElements({ flatten: true }).find((el) => el.matches("input, select, textarea, button")) as HTMLElement | undefined;
	}

	/** Give the control the field's name as its accessible name, unless it already carries one of its own. */
	private nameControl = (): void => {
		const control = this.control();
		if (control && this.label && !control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-label", this.label);
	};

	/** Pressing the name presses the control, as pressing a label does. */
	private pressControl = (): void => {
		const control = this.control();
		if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) control.click();
		else control?.focus();
	};

	protected updated(): void {
		this.nameControl(); // a label set after the first render still reaches its control
	}
}

if (!customElements.get("shu-field")) {
	customElements.define("shu-field", ShuField);
}
