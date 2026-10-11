/**
 * <shu-refusal>: a refusal's cause, a control that copies it, and its remedy as a native control (CA4F4): a link that signs
 * in, a button that reloads or reads again, and a link to what a reference names. The page performs a reload through its
 * remedies port.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import type { TPageRefusal, TPageRemedy } from "../domains/refusal.js";
import { isRefKind, refLabel } from "../derivations/markdown.js";
import { defineElement } from "../controllers/element-controller.js";
import { reloadFor } from "../controllers/remedy-controller.js";
import { ShuElement, type TLinkedData, EmptyStateSchema } from "./shu-element.js";
import { refHref } from "./ref-navigation.js";
import { shuBaseStyles } from "./styles.js";
import "./shu-copy-button.js";

/** What a reload reads again, as its control states it. */
const RELOAD_SAID = { client: "Reload the page", actuality: "Read actuality again", authority: "Read the authority again" } as const;

export class ShuRefusal extends ShuElement<typeof EmptyStateSchema> {
	/** A refusal is part of the view that shows it, so it doesn't contribute to the Kihan's context on its own. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; }
			.refusal { display: flex; flex-wrap: wrap; gap: var(--shu-space-3); align-items: baseline; color: var(--shu-error); }
		`,
	];

	/** The refusal the view shows. */
	@property({ attribute: false }) accessor refusal: TPageRefusal | undefined = undefined;
	/** Reads the refused read again, which a read-again remedy performs. */
	@property({ attribute: false }) accessor readAgain: (() => void) | undefined = undefined;

	constructor() {
		super(EmptyStateSchema);
	}

	/** Returns the control that performs `remedy`. Throws for a read-again remedy that the view isn't given a read for, and
	 *  for a reference whose kind isn't a reference's. */
	private remedyControl(remedy: TPageRemedy): TemplateResult {
		const id = SHU_TEST_IDS.REFUSAL.REMEDY;
		if (remedy.do === "sign-in") return html`<a href=${remedy.at} data-testid=${id}>Sign in</a>`;
		if (remedy.do === "reload") return html`<button type="button" data-testid=${id} @click=${() => reloadFor(remedy.what)}>${RELOAD_SAID[remedy.what]}</button>`;
		if (remedy.do === "read-again") {
			const readAgain = this.readAgain;
			if (readAgain === undefined) throw new Error("<shu-refusal> offers a read again, and isn't given the read");
			return html`<button type="button" data-testid=${id} @click=${() => readAgain()}>Read again</button>`;
		}
		const { kind, target } = remedy.ref;
		if (!isRefKind(kind)) throw new Error(`<shu-refusal> opens a reference of the kind ${kind}, which isn't a reference's`);
		return html`<a href=${refHref(kind, target) ?? nothing} data-testid=${id}>Open ${refLabel(kind, JSON.stringify(target))}</a>`;
	}

	render(): TemplateResult {
		const { refusal } = this;
		if (refusal === undefined) throw new Error("<shu-refusal> renders before it is given a refusal");
		return html`<div class="refusal" role="alert" data-testid=${SHU_TEST_IDS.REFUSAL.ROOT}>
			<span data-testid=${SHU_TEST_IDS.REFUSAL.CAUSE}>${refusal.error}</span>
			<shu-copy-button label="copy" title="copy this message" .source=${refusal.error}></shu-copy-button>
			${refusal.remedy === undefined ? nothing : this.remedyControl(refusal.remedy)}
		</div>`;
	}
}

defineElement(SHU_TAG.REFUSAL, ShuRefusal);
