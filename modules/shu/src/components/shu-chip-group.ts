/**
 * <shu-chip-group> — one labelled row of toggle chips: a name, then a checkbox chip per member, each optionally
 * counted and swatch-coloured. The graph filter renders every one of its groups through this — the data types, the
 * edge properties, and each group-by-reference axis — so a chip behaves the same wherever it appears: tick to show,
 * untick to hide, hover to preview.
 *
 * It owns NO state. The host supplies the chips and hears intent back through `onToggle`/`onPreview`; what a chip's
 * visibility means (a hidden type, a hidden predicate, a hidden axis value) is the host's business.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";

/** One chip: its identity, what it shows, whether it is on, and (optionally) how many it stands for and its swatch. */
export type TChip = { id: string; label: string; checked: boolean; count?: number; color?: string };

export class ShuChipGroup extends ShuElement<z.ZodType> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static properties = {
		name: { attribute: true },
		chips: { attribute: false },
		onToggle: { attribute: false },
		onPreview: { attribute: false },
	};

	/** The group's name, shown before the chips ("types", "properties", "group by role"). */
	declare name: string;
	declare chips: TChip[];
	/** Reports a chip ticked or unticked. The host decides what visibility means. */
	declare onToggle: (id: string, checked: boolean) => void;
	/** Reports a chip hovered (id) or the hover ending (null). Optional: a group with no preview passes nothing. */
	declare onPreview?: (id: string | null) => void;

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; align-items: center; gap: var(--shu-space-3); flex-wrap: wrap; font-size: var(--shu-font-md); }
			.name { color: var(--shu-fg-muted); }
			label.chip { display: inline-flex; align-items: center; gap: var(--shu-space-1); cursor: pointer; font-size: var(--shu-font-sm); padding: var(--shu-space-1) var(--shu-space-2); border-radius: var(--shu-radius); border: var(--shu-border-w) solid var(--shu-border); color: var(--shu-fg); }
			/* A swatch chip carries its type colour; its text is the on-swatch ink, dark in both themes on the light palette. */
			label.chip[data-swatch] { color: var(--shu-fg-on-swatch); border-color: transparent; }
			label.chip:hover { filter: brightness(0.95); }
			label.chip input[type="checkbox"] { margin: 0; flex-shrink: 0; }
			.count { opacity: 0.7; font-size: var(--shu-font-xs); }
			.empty { color: var(--shu-fg-faded); font-size: var(--shu-font-sm); }
		`,
	];

	constructor() {
		super(z.object({}), {});
		this.name = "";
		this.chips = [];
		this.onToggle = () => {
			throw new Error("shu-chip-group reports intent to its host: set .onToggle");
		};
	}

	/** The host owns what a chip's state means, so the box is put back to what the host had before the report and only a
	 *  host state change moves it. A host that intercepts the toggle (the graph filter's solo tool answers a tick by
	 *  showing that type ALONE) would otherwise leave the box showing a state nobody took: the browser has already
	 *  flipped it, and the binding, seeing its value unchanged, writes nothing. */
	private toggle(chip: TChip, e: Event): void {
		const input = e.target as HTMLInputElement;
		const reported = input.checked;
		input.checked = chip.checked;
		this.onToggle(chip.id, reported);
	}

	render(): TemplateResult {
		return html`<span class="name">${this.name}:</span>
			${this.chips.length === 0 ? html`<span class="empty">none</span>` : ""}
			${this.chips.map(
				(c) =>
					html`<label
						class="chip"
						?data-swatch=${c.color !== undefined}
						style=${c.color ? `background:${c.color}` : ""}
						@mouseenter=${() => this.onPreview?.(c.id)}
						@mouseleave=${() => this.onPreview?.(null)}
						><input type="checkbox" .checked=${c.checked} @change=${(e: Event) => this.toggle(c, e)} />${c.label}${
							c.count !== undefined ? html` <span class="count">(${c.count})</span>` : ""
						}</label
					>`,
			)}`;
	}
}

if (!customElements.get("shu-chip-group")) {
	customElements.define("shu-chip-group", ShuChipGroup);
}
