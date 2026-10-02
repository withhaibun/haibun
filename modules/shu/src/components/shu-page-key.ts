/**
 * <shu-page-key>: the public key this page signs with, as the did:key a holder delegates to, and a way to take it away.
 * The private key stays in the browser's key store, so the public key shown here isn't a secret.
 *
 * A page holds only what was delegated to its key here, so the key is what a reader hands to whoever may delegate to
 * it: shown alone while the page doesn't hold a read, and in the permissions panel after.
 */
import { SHU_TAG } from "../consts.js";
import { defineElement } from "../define-element.js";
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PageKeySchema } from "../schemas.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { recordRef } from "./shu-ref.js";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";

export class ShuPageKey extends ShuElement<typeof PageKeySchema> {
	static attributeFields = { controller: "controller" };

	constructor() {
		super(PageKeySchema, { controller: "" });
	}

	/** A key names who the page is, not what it shows, so it doesn't add to the Kihan's context. */
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
		// The key a delegation names is recorded as the Principal it is, so it opens as that record.
		return html`<code data-testid=${SHU_TEST_IDS.APP.PAGE_KEY}>${recordRef(PRINCIPAL_LABEL, controller)}</code><shu-copy-button label="copy" title="copy this page's public key, which a holder delegates to" .source=${controller}></shu-copy-button>`;
	}
}

defineElement(SHU_TAG.PAGE_KEY, ShuPageKey);
