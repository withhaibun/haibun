/**
 * `<shu-affordance>`: Lit element that renders one `TAffordance` as a button
 * and routes the click through shu's existing browser-routing layer. Every
 * clickable user action in shu, server-emitted `_links` follows, SPA-side
 * step pickers, and view navigations, goes through this component.
 *
 *   follow    → invokes the link via `conduit().follow(...)` and hands the
 *               result to `dispatchAffordanceFromResponse`, the same path the
 *               step-caller uses. PaneState routes by `_type`/products and
 *               keeps the URL hash in sync.
 *   pick-step → dispatches `SHU_EVENT.STEP_CHOOSE`; the actions-bar listens
 *               and pre-fills the step-caller.
 *   open-view → dispatches `SHU_EVENT.COLUMN_OPEN` with the subject; the app
 *               root's existing listener calls PaneState.request, which opens
 *               the column and updates the URL hash.
 *
 * Errors thrown during click handling bubble as `affordance-error` events
 * carrying the affordance and reason. Parents decide their own UX.
 */

import { errorDetail } from "@haibun/core/lib/util/index.js";
import { LitElement, html, css } from "lit";
import { SHU_EVENT } from "./consts.js";
import { acts, conduit, type TAffordance, type TRepresentation } from "./hypermedia.js";
import { dispatchAffordanceFromResponse } from "./affordance-dispatch.js";

export class ShuAffordance extends LitElement {
	static styles = css`
		button { font: inherit; cursor: pointer; padding: 2px 8px; border: 1px solid #ccc; border-radius: 3px; background: #f8f8f8; }
		button:hover { background: #e8f0fe; }
		button[disabled] { cursor: progress; opacity: 0.6; }
	`;

	static properties = { affordance: { attribute: false }, pending: { type: Boolean, reflect: true } };

	affordance!: TAffordance;
	pending = false;

	render() {
		const a = this.affordance;
		return html`<button ?disabled=${this.pending || !a} title=${a?.summary ?? ""} @click=${this.handle}>${a?.label ?? "(no affordance)"}</button>`;
	}

	private async handle(): Promise<void> {
		const a = this.affordance;
		if (!a) return;
		this.pending = true;
		try {
			if (a.kind === "follow") {
				const rep = await conduit().follow<TRepresentation>(acts(a.method, a.params), a.why);
				dispatchAffordanceFromResponse(rep);
				this.dispatchEvent(new CustomEvent<TRepresentation>("representation", { detail: rep, bubbles: true, composed: true }));
			} else if (a.kind === "pick-step") {
				this.dispatchEvent(new CustomEvent<{ method: string }>(SHU_EVENT.STEP_CHOOSE, { detail: { method: a.method }, bubbles: true, composed: true }));
			} else if (a.kind === "open-view") {
				this.dispatchEvent(
					new CustomEvent<{ subject: string; label: string }>(SHU_EVENT.COLUMN_OPEN, { detail: { subject: a.subject, label: a.persistedAs }, bubbles: true, composed: true }),
				);
			}
		} catch (err) {
			this.dispatchEvent(
				new CustomEvent<{ affordance: TAffordance; error: string }>("affordance-error", {
					detail: { affordance: a, error: errorDetail(err) },
					bubbles: true,
					composed: true,
				}),
			);
		} finally {
			this.pending = false;
		}
	}
}

if (!customElements.get("shu-affordance")) customElements.define("shu-affordance", ShuAffordance);
