/**
 * <shu-permissions> — what this reader may do here, and the authority behind it.
 *
 * A reader who is refused something needs to see why, and an operator deciding on an agent's request needs to see what
 * they themselves hold. Three things say that: the actions this page's own credential holds, the principals this
 * deployment knows, and the grants its authority stands on. The grant rows carry no token: a bearer token is the
 * credential, so a listing carrying one hands it over.
 *
 * Shown from the access indicator, beside the level a read is bounded by — a capability decides whether a question may
 * be put, the level decides how much of the answer comes back, and a reader is looking at both in one place.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PermissionsSchema } from "../schemas.js";
import { AuthorityController, type TAuthority } from "../controllers/index.js";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import { refTpl } from "./shu-ref.js";
import type { TRefKind } from "./ref-navigation.js";

/** What the access indicator says beside the level, and the event carrying it: one count per thing this panel lists. */
export const PERMISSIONS_SUMMARY = "permissions-summary";
export type TPermissionsSummary = { holds: number; principals: number; grants: number };
export const summaryOf = (held: TAuthority): TPermissionsSummary => ({ holds: held.holds.length, principals: held.principals.length, grants: held.grants.length });

export class ShuPermissions extends ShuElement<typeof PermissionsSchema> {
	static persistFields = ["showGrants", "showPrincipals"] as const;

	#authority = new AuthorityController(this);
	/** How many items await the reader's decision, and the reference that leads to them. Set by the host, which hears
	 *  it from whichever extension reports it: the panel states the count in a row of its own beside the access level. */
	awaiting = 0;
	awaitingRef: { kind: TRefKind; target: Record<string, unknown> } | null = null;

	/** The read access in force and the ones on offer, owned by the host that reads them from the view hash. */
	declare level: string;
	declare levels: readonly string[];
	declare onLevelChange: (level: string) => void;
	private held: TAuthority = { holds: [], principals: [], grants: [] };
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
		return { "@type": "ShuPermissions", holds: this.held.holds, grants: this.held.grants.length, principals: this.held.principals.length };
	}

	static styles = [
		shuBaseStyles,
		css`
		/* It shares the corner popover with the level control, so it takes the room it needs and no more: a section a
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
		.revoked { text-decoration: line-through; color: var(--shu-fg-muted); }
		.failure { color: var(--shu-danger, crimson); }
		.revoke { margin-left: var(--shu-space-2); font: inherit; font-size: var(--shu-font-sm); cursor: pointer; }
	`,
	];

	protected onConnected(): void {
		void this.read();
	}

	/** What the deployment says about itself: what this reader holds, its principals, and the grants behind them. Read
	 *  again after anything changes what holds, and said upward each time, so the indicator that summarises this panel
	 *  counts what the panel is showing rather than what it found once. */
	private async read(): Promise<void> {
		try {
			this.held = await this.#authority.read();
			this.dispatchEvent(new CustomEvent(PERMISSIONS_SUMMARY, { detail: summaryOf(this.held), bubbles: true, composed: true }));
		} catch (err) {
			this.failure = errorDetail(err);
		}
		this.requestUpdate();
	}

	private onToggleGrants = (): void => {
		this.setState({ showGrants: !this.state.showGrants });
	};

	/** An action, as the step that granted it: opening it opens that step, where what was granted and by whom is
	 *  recorded. An action nothing here granted is still named, since a reader holds it either way. */
	private grantedAt(action: string, seqPath: string | undefined): TemplateResult {
		if (!seqPath) return html`<span class="action">${action}</span>`;
		return refTpl("seqPath", { seqPath: seqPath.split(".").map(Number) }, action);
	}

	private onTogglePrincipals = (): void => {
		this.setState({ showPrincipals: !this.state.showPrincipals });
	};

	/** Break a grant: it stops holding at once, so what it allowed is refused from the next call. The listing is read
	 *  again rather than edited in place, since what holds is the authority's answer and not this view's memory. */
	private onRevoke(handle: string): () => void {
		return () => {
			void this.#authority
				.revoke(handle)
				.then(() => this.read())
				.catch((err) => {
					this.failure = errorDetail(err);
					this.requestUpdate();
				});
		};
	}

	render(): TemplateResult {
		const { holds, principals, grants } = this.held;
		// An action is held BY a grant, so it reads as the grant that gave it: where it was granted opens as its own
		// column, which is the ordinary way anything here opens.
		const granting = (action: string) => grants.find((g) => !g.revoked && g.allowedAction.includes(action));
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

			<h3>what this session may do</h3>
			${
				holds.length
					? html`<ul class="holds">
						${holds.map((action) => html`<li>${this.grantedAt(action, granting(action)?.seqPath)}</li>`)}
					</ul>`
					: html`<p class="none">only what needs no authority here; this deployment gave this page no credential</p>`
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

			<h3>
				<button type="button" aria-expanded=${this.state.showGrants} @click=${this.onToggleGrants}>
					${this.state.showGrants ? "▾" : "▸"} grants (${grants.length})
				</button>
			</h3>
			${
				this.failure
					? html`<p class="failure">
							${this.failure}
							<shu-copy-button label="copy" title="copy this message" .source=${this.failure}></shu-copy-button>
						</p>`
					: ""
			}
			${
				this.state.showGrants
					? html`<ul>
						${grants.map(
							(g) => html`<li class=${g.revoked ? "revoked" : ""}>
								${g.allowedAction.join(", ")} — granted by
								${g.controller ? refTpl("entity", { persistedAs: PRINCIPAL_LABEL, id: g.controller }, g.controller) : "nobody named"}
								${g.seqPath ? html` at ${refTpl("seqPath", { seqPath: g.seqPath.split(".").map(Number) }, g.seqPath)}` : ""}
								${g.note ? html` <span class="none">(${g.note})</span>` : ""}
								${g.revoked ? "" : html`<button type="button" class="revoke" title="stop this grant holding, from the next call" @click=${this.onRevoke(g.handle)}>revoke</button>`}
							</li>`,
						)}
					</ul>`
					: ""
			}
		`;
	}
}
