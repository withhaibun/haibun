/**
 * <shu-permissions>: what this reader may do here, and the authority behind it.
 *
 * A reader who is refused something needs to see why, and an operator deciding on an agent's request needs to see what
 * they themselves hold. Three things say that: the key this page signs as, the actions delegated to it, and the
 * principals this deployment knows.
 *
 * Shown from the access indicator, beside the level a read is bounded by: a capability decides whether a question may
 * be put, the level decides how much of the answer comes back, and a reader is looking at both in one place.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PermissionsSchema } from "../schemas.js";
import { AuthorityController, type TAuthority } from "../controllers/index.js";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import { actionRef, refTpl } from "./shu-ref.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import type { TRefKind } from "./ref-navigation.js";

/** What the access indicator says beside the level, and the event carrying it: one count per thing this panel lists. */
export const PERMISSIONS_SUMMARY = "permissions-summary";
export type TPermissionsSummary = { holds: number; principals: number };
export const summaryOf = (held: TAuthority): TPermissionsSummary => ({ holds: held.holds.length, principals: held.principals.length });

export class ShuPermissions extends ShuElement<typeof PermissionsSchema> {
	static persistFields = ["showPrincipals"] as const;

	#authority = new AuthorityController(this);
	/** How many items await the reader's decision, and the reference that leads to them. Set by the host, which hears
	 *  it from whichever extension reports it: the panel states the count in a row of its own beside the access level. */
	awaiting = 0;
	awaitingRef: { kind: TRefKind; target: Record<string, unknown> } | null = null;

	/** The read access in force and the ones on offer, owned by the host that reads them from the view hash. */
	declare level: string;
	declare levels: readonly string[];
	declare onLevelChange: (level: string) => void;
	private held: TAuthority = { holds: [], grantedBy: {}, principals: [] };

	private failure = "";

	static observedHtmlAttributes = [];

	constructor() {
		super(PermissionsSchema, {});
		this.level = "";
		this.levels = [];
		this.onLevelChange = () => undefined;
	}

	/** A reading of this deployment's authority is part of what a Kihan is looking at, so it summarizes as what it shows. */
	summarizeForKihan(): TLinkedData | null {
		return { "@type": "ShuPermissions", holds: this.held.holds, principals: this.held.principals.length };
	}

	static styles = [
		shuBaseStyles,
		css`
		/* It shares the corner popover with the level control, so it takes only the room it needs: a section a
		   reader opens scrolls within the panel rather than growing it past what is behind it. */
		:host { display: block; color: var(--shu-fg); font-size: var(--shu-font-sm); width: 20rem; max-width: 100%; max-height: 40vh; overflow-y: auto; user-select: text; }
		h3 { font-size: var(--shu-font-sm); margin: var(--shu-space-2) 0 var(--shu-space-1); }
		ul { margin: 0; padding-left: var(--shu-space-4); }
		li { margin-bottom: var(--shu-space-1); }
		.holds { list-style: none; padding-left: 0; }
		.action { border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: 0 var(--shu-space-2); font: inherit; font-size: var(--shu-font-sm); color: inherit; background: none; cursor: pointer; }
		.action:hover { background: var(--shu-bg-hover); }
		/* The level reads on one line with what it bounds, since it is the first thing this panel says. */
		.level { display: flex; align-items: center; gap: var(--shu-space-2); }
		.level label { color: var(--shu-fg-muted); }
		/* An alert a reader cannot miss: the accent as its ground rather than its text, so it reads as a state of the
		   panel and not another line in it. */
		.awaiting-row { display: flex; align-items: center; gap: var(--shu-space-2); margin-top: var(--shu-space-2); padding: var(--shu-space-2) var(--shu-space-3); border-radius: var(--shu-radius); background: var(--shu-accent); color: var(--shu-bg); font-weight: 600; }
		.awaiting-row .awaiting-count { font-size: 1.2em; }
		.awaiting-row shu-ref { --shu-accent: var(--shu-bg); }
		.awaiting-row[hidden] { display: none; }
		.none { color: var(--shu-fg-muted); }
		.failure { color: var(--shu-danger, crimson); }
	`,
	];

	protected onConnected(): void {
		void this.read();
	}

	/** What the deployment says about itself: what this reader holds and its principals. Said upward each time it is
	 *  read, so the indicator that summarises this panel counts what the panel is showing rather than what it found once. */
	private async read(): Promise<void> {
		try {
			this.held = await this.#authority.read();
			this.dispatchEvent(new CustomEvent(PERMISSIONS_SUMMARY, { detail: summaryOf(this.held), bubbles: true, composed: true }));
		} catch (err) {
			this.failure = errorDetail(err);
		}
		this.requestUpdate();
	}

	/**
	 * An action, as what granted it. A reader holds what it holds by a delegation this deployment records, so the action
	 * opens that record, and from there what it was delegated from and on to its root. An action this deployment didn't record,
	 * such as one allowed without a delegation, is still named, since a reader holds it either way.
	 */
	private grantedAt(action: string): TemplateResult {
		const grantedBy = this.held.grantedBy[action];
		if (grantedBy) return refTpl("entity", { persistedAs: grantedBy.persistedAs, id: grantedBy.id }, action, SHU_TEST_IDS.APP.HELD);
		return html`<span class="action">${actionRef(action)}</span>`;
	}

	private onTogglePrincipals = (): void => {
		this.setState({ showPrincipals: !this.state.showPrincipals });
	};

	render(): TemplateResult {
		const { controller, holds, principals } = this.held;
		return html`
			<div class="level">
				<label for="read-access">read access</label>
				<select id="read-access" data-testid="permissions-read-access" @change=${(e: Event) => this.onLevelChange((e.target as HTMLSelectElement).value)}>
					${this.levels.map((l) => html`<option value=${l} ?selected=${l === this.level}>${l}</option>`)}
				</select>
			</div>

			<div class="awaiting-row" role="alert" ?hidden=${this.awaiting <= 0}>
				<span class="awaiting-count">${this.awaiting}</span>
				<span>${this.awaiting === 1 ? "petition awaits your decision" : "petitions await your decision"}</span>
				${refTpl(this.awaitingRef?.kind ?? "domain", this.awaitingRef?.target ?? {}, "read them", "permissions-awaiting")}
			</div>

			<h3>this page signs as</h3>
			${controller ? html`<shu-page-key controller=${controller}></shu-page-key>` : html`<p class="none">this page doesn't hold a key, so it holds only what doesn't need a delegation here</p>`}

			<h3>what this page may do</h3>
			${
				holds.length
					? html`<ul class="holds">
						${holds.map((action) => html`<li>${this.grantedAt(action)}</li>`)}
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
						${principals.map((p) => html`<li>${refTpl("entity", { persistedAs: PRINCIPAL_LABEL, id: p.id }, p.id)}</li>`)}
					</ul>`
					: ""
			}

			${
				this.failure
					? html`<p class="failure">
							${this.failure}
							<shu-copy-button label="copy" title="copy this message" .source=${this.failure}></shu-copy-button>
						</p>`
					: ""
			}
		`;
	}
}
