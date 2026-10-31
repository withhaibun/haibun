/**
 * <shu-permissions>: what this reader may do here, and the authority behind it.
 *
 * A reader who is refused something needs to see why, and an operator deciding on an agent's request needs to see what
 * they themselves hold. Three things show that: the key this page signs as, the actions delegated to it, and the
 * principals this deployment holds.
 *
 * Shown from the access indicator, beside the level a read is bounded by: a capability determines whether a call may
 * be made, the level determines how much of the result comes back, and a reader is looking at both in one place.
 */
import type { TAction } from "@haibun/core/lib/domains/actions.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, nothing, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PermissionsSchema } from "../../domains/schemas.js";
import { AuthorityController, type TAuthority } from "../controllers/authority-controller.js";
import { principalAddress } from "@haibun/core/lib/domains/resources.js";
import { actionRef, refTpl, recordRef } from "./shu-ref.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import type { TRef } from "../derivations/markdown.js";
import { LoadController } from "../controllers/load-controller.js";
import { refusalTpl } from "./load-renders.js";
import "./shu-page-key.js";

/** What the access indicator shows beside the level, and the event carrying it: one count per thing this panel lists. */
export const PERMISSIONS_SUMMARY = "permissions-summary";
export type TPermissionsSummary = { holds: number; principals: number };
export const summaryOf = (held: TAuthority): TPermissionsSummary => ({ holds: held.holds.length, principals: held.principals.length });

export class ShuPermissions extends ShuElement<typeof PermissionsSchema> {
	static persistFields = ["showPrincipals"] as const;

	#authority = new AuthorityController(this);
	/** What holds here, read when the panel connects. */
	readonly #held = new LoadController<TAuthority>(this, () => this.#authority.readOutcome());
	/** How many items await the reader's decision, and the reference that leads to them. Set by the host, which receives
	 *  it from whichever extension reports it: the panel states the count in a row of its own beside the access level. */
	awaiting = 0;
	awaitingRef: TRef | null = null;

	/** The read access in force and the ones on offer, owned by the host that reads them from the view hash. */
	declare level: string;
	declare levels: readonly string[];
	declare onLevelChange: (level: string) => void;
	static observedHtmlAttributes = [];

	constructor() {
		super(PermissionsSchema, { showPrincipals: false });
		this.level = "";
		this.levels = [];
		this.onLevelChange = () => undefined;
	}

	/** A reading of this deployment's authority is part of what a model reads, so it summarizes as what it shows. */
	summarizeForContext(): TLinkedData | null {
		const held = this.#held.page;
		return held === undefined ? null : { "@type": "ShuPermissions", holds: held.holds, principals: held.principals.length };
	}

	static styles = [
		shuBaseStyles,
		// It shares the corner popover with the level control, so it takes only the room it needs: a section a reader opens
		// scrolls within the panel rather than growing it past what is behind it.
		// The level reads on one line with what it bounds, since it is the first thing this panel shows.
		// An alert a reader cannot miss: the accent as its ground rather than its text, so it reads as a state of the panel and
		// not another line in it.
		css`
		:host { display: block; color: var(--shu-fg); font-size: var(--shu-font-sm); width: 20rem; max-width: 100%; max-height: 40vh; overflow-y: auto; user-select: text; }
		h3 { font-size: var(--shu-font-sm); margin: var(--shu-space-2) 0 var(--shu-space-1); }
		ul { margin: 0; padding-left: var(--shu-space-4); }
		li { margin-bottom: var(--shu-space-1); }
		.holds { list-style: none; padding-left: 0; }
		.action { border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: 0 var(--shu-space-2); font: inherit; font-size: var(--shu-font-sm); color: inherit; background: none; cursor: pointer; }
		.action:hover { background: var(--shu-bg-hover); }
		.level { display: flex; align-items: center; gap: var(--shu-space-2); }
		.level label { color: var(--shu-fg-muted); }
		.awaiting-row { display: flex; align-items: center; gap: var(--shu-space-2); margin-top: var(--shu-space-2); padding: var(--shu-space-2) var(--shu-space-3); border-radius: var(--shu-radius); background: var(--shu-accent); color: var(--shu-bg); font-weight: 600; }
		.awaiting-row .awaiting-count { font-size: 1.2em; }
		.awaiting-row shu-ref { --shu-accent: var(--shu-bg); }
		.awaiting-row[hidden] { display: none; }
		.none { color: var(--shu-fg-muted); }
	`,
	];

	protected onConnected(): void {
		void this.read();
	}

	/** What the deployment holds about itself: what this reader holds and its principals. Reported upward each time it is
	 *  read, so the indicator that summarises this panel counts what the panel is showing rather than what it found once. */
	private async read(): Promise<void> {
		await this.#held.run();
		const held = this.#held.page;
		if (held !== undefined) this.dispatchEvent(new CustomEvent(PERMISSIONS_SUMMARY, { detail: summaryOf(held), bubbles: true, composed: true }));
	}

	/**
	 * An action, as what granted it. A reader holds what it holds by a delegation this deployment records, so the action
	 * opens that record, and from there what it was delegated from and on to its root. An action this deployment didn't record,
	 * such as one allowed without a delegation, is still named, since a reader holds it either way.
	 */
	private grantedAt(held: TAuthority, action: TAction): TemplateResult {
		const grantedBy = held.grantedBy[action];
		if (grantedBy) return recordRef({ persistedAs: grantedBy.persistedAs, id: grantedBy.id }, action, SHU_TEST_IDS.APP.HELD);
		return html`<span class="action">${actionRef(action)}</span>`;
	}

	private onTogglePrincipals = (): void => {
		this.setState({ showPrincipals: !this.state.showPrincipals });
	};

	render(): TemplateResult {
		return html`
			<div class="level">
				<label for="read-access">read access</label>
				<select id="read-access" data-testid="permissions-read-access" @change=${(e: Event) => this.onLevelChange((e.target as HTMLSelectElement).value)}>
					${this.levels.map((l) => html`<option value=${l} ?selected=${l === this.level}>${l}</option>`)}
				</select>
			</div>

			<div class="awaiting-row" role="alert" ?hidden=${this.awaiting <= 0}>
				<span class="awaiting-count">${this.awaiting}</span>
				<span>${this.awaiting === 1 ? "change request awaits your decision" : "change requests await your decision"}</span>
				${this.awaitingRef === null ? nothing : refTpl(this.awaitingRef, "read them", "permissions-awaiting")}
			</div>
			${this.#held.render<TemplateResult>({
				pending: () => html`<p class="none">reading what holds here</p>`,
				running: () => html`<p class="none">reading what holds here</p>`,
				completed: (held) => this.renderHeld(held),
				failed: (refusal) => refusalTpl(refusal, { run: () => this.read() }),
			})}
		`;
	}

	/** What holds here: the key the page signs as, what it may do and by what grant, and the principals. */
	private renderHeld(held: TAuthority): TemplateResult {
		const { controller, holds, principals } = held;
		return html`
			<h3>this page signs as</h3>
			${controller ? html`<shu-page-key controller=${controller}></shu-page-key>` : html`<p class="none">this page doesn't hold a key, so it holds only what doesn't need a delegation here</p>`}

			<h3>what this page may do</h3>
			${
				holds.length
					? html`<ul class="holds">
						${holds.map((action) => html`<li>${this.grantedAt(held, action)}</li>`)}
					</ul>`
					: html`<p class="none">this page's key doesn't hold a delegation</p>`
			}

			<h3>
				<button type="button" aria-expanded=${this.state.showPrincipals} @click=${this.onTogglePrincipals}>
					${this.state.showPrincipals ? "▾" : "▸"} principals (${principals.length})
				</button>
			</h3>
			${
				this.state.showPrincipals
					? html`<ul>
						${principals.map((p) => html`<li>${recordRef(principalAddress(p.id), p.id)}</li>`)}
					</ul>`
					: ""
			}
		`;
	}
}

defineElement(SHU_TAG.PERMISSIONS, ShuPermissions);
