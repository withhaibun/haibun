/**
 * <shu-page-key>: the key this page signs with, as the did:key a holder delegates to, and a way to take it away.
 *
 * A page holds only what was delegated to its key here, so the key is what a reader hands to whoever may delegate to
 * it: shown alone while the page holds no read, and in the permissions panel after.
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PageKeySchema } from "../schemas.js";
import { SHU_TEST_IDS } from "../test-ids.js";

export class ShuPageKey extends ShuElement<typeof PageKeySchema> {
	static attributeFields = { controller: "controller" };

	constructor() {
		super(PageKeySchema, { controller: "" });
	}

	/** A key names who the page is, not what it shows, so it adds nothing to what a Kihan is looking at. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; align-items: center; gap: var(--shu-space-2); min-width: 0; }
			code { overflow-wrap: anywhere; user-select: all; }
		`,
	];

	render(): TemplateResult {
		const { controller } = this.state;
		return html`<code data-testid=${SHU_TEST_IDS.APP.PAGE_KEY}>${controller}</code><shu-copy-button label="copy" title="copy this page's key" .source=${controller}></shu-copy-button>`;
	}
}
