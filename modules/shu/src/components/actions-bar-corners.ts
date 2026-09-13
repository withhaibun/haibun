/**
 * The corner controls on the actions bar's strip and the one popover they open: the settings, the read access level with
 * the authority a reader holds, the time offset with the run's playback, and the full text of the bar's status. One
 * corner is open at a time. The popover floats in the top layer above the whole bar, so it never needs the bar opened
 * and never covers the bar's own input line.
 */
import { html, nothing, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { AccessQueryLevelSchema } from "@haibun/core/lib/resources.js";
import { AuthorityController } from "../controllers/index.js";
import { AWAITING_DECISION, PERMISSIONS_SLOT, SHU_TAG } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { runSpan } from "../client-cache/index.js";
import { getUiExtensionTags } from "../rels-cache.js";
import { PERMISSIONS_SUMMARY, summaryOf, type TPermissionsSummary } from "./shu-permissions.js";
import { isRefKind, type TRefKind } from "./ref-navigation.js";
import { timeOffsetLabel } from "./actions-bar-model.js";

export const CORNERS = ["settings", "playback", "access", "status"] as const;
export type TCorner = (typeof CORNERS)[number];

/** How each corner's popover closes. A picker closes on a click away. Playback is a panel used beside the view (set the
 *  run playing, then open a node to see it at that moment), so only its own control closes it. A new corner states
 *  which it is. */
export const CORNER_DISMISS: Record<TCorner, "click-away" | "panel"> = { settings: "click-away", access: "click-away", playback: "panel", status: "click-away" };

/** What an extension in the permissions area says awaits the reader's decision: how many, and the reference that leads
 *  to them. */
export type TAwaiting = { count: number; ref: { kind: TRefKind; target: Record<string, unknown> } | null };

/** The awaiting mark an event's detail states, or null for a detail whose count is not a number, which states nothing.
 *  A count below zero is none, and a reference of a kind a ref cannot open is no reference. */
export function awaitingOf(detail: { count?: unknown; kind?: string; target?: Record<string, unknown> } | undefined): TAwaiting | null {
	const count = Number(detail?.count ?? 0);
	if (!Number.isFinite(count)) return null;
	return { count: Math.max(0, count), ref: isRefKind(detail?.kind) && detail?.target ? { kind: detail.kind, target: detail.target } : null };
}

/** The time offset the strip shows for a cursor: `now` at the live edge, and how far along the run it sits otherwise.
 *  The run's span is read off the shared event log without registering a window, since the bar is mounted for the whole
 *  session and a window it held would page the entire run in and pin it there. */
export function timeOffsetOf(cursor: number | null): string {
	if (cursor === null || cursor <= 0) return "now";
	const { first, last } = runSpan();
	return timeOffsetLabel(cursor, first, last);
}

/** What the corners read from the bar: its test-id prefix, the read access level and how to change it, and the popover
 *  element once rendered. */
export type TActionsBarCornersDeps = {
	testIdPrefix: () => string;
	accessLevel: () => string;
	setAccessLevel: (level: string) => void;
	popover: () => HTMLElement | null;
};

export class ActionsBarCorners implements ReactiveController {
	readonly #host: ReactiveControllerHost & HTMLElement;
	readonly #deps: TActionsBarCornersDeps;
	/** What this reader holds and how many grants stand behind them: the access indicator says both beside the level. */
	readonly #authority: AuthorityController;
	#open: TCorner | null = null;
	#status = "";
	#summary: TPermissionsSummary = { holds: 0, principals: 0, grants: 0 };
	#awaiting: TAwaiting = { count: 0, ref: null };
	#timeOffset = "now";

	constructor(host: ReactiveControllerHost & HTMLElement, deps: TActionsBarCornersDeps) {
		this.#host = host;
		this.#deps = deps;
		this.#authority = new AuthorityController(host);
		host.addController(this);
	}

	hostConnected(): void {
		document.addEventListener("click", this.#onDocumentClick, true);
		// An extension in the permissions area reports what awaits from anywhere in the page, so the mark shows before the
		// popover has been opened.
		document.addEventListener(AWAITING_DECISION, this.#onAwaiting);
		this.#host.addEventListener(PERMISSIONS_SUMMARY, this.#onSummary);
		// Read once so the numbers are there before the panel is opened, and taken from the panel after, since the panel
		// reads again whenever what holds changes.
		void this.#authority
			.read()
			.then((held) => this.#setSummary(summaryOf(held)))
			.catch(() => undefined);
	}

	hostDisconnected(): void {
		document.removeEventListener("click", this.#onDocumentClick, true);
		document.removeEventListener(AWAITING_DECISION, this.#onAwaiting);
		this.#host.removeEventListener(PERMISSIONS_SUMMARY, this.#onSummary);
	}

	get openCorner(): TCorner | null {
		return this.#open;
	}

	get awaiting(): TAwaiting {
		return this.#awaiting;
	}

	/** Say something on the strip, in full in the status popover. */
	setStatus(message: string): void {
		this.#status = message;
		this.#host.requestUpdate();
	}

	/** Show where the time cursor sits in the run. */
	showTime(cursor: number | null): void {
		const label = timeOffsetOf(cursor);
		if (label === this.#timeOffset) return;
		this.#timeOffset = label;
		this.#host.requestUpdate();
	}

	/** Open a corner's popover, closing any other, or close it when it is the one open. The click is the corner's own,
	 *  so it does not reach the strip, which would open or close the bar. */
	toggle(corner: TCorner): (e: Event) => void {
		return (e: Event) => {
			e.stopPropagation();
			if (this.#open === corner) return this.close();
			this.#open = corner;
			const control = e.currentTarget as HTMLElement;
			this.#host.requestUpdate();
			void this.#host.updateComplete.then(() => this.#show(control));
		};
	}

	close(): void {
		const popover = this.#deps.popover();
		if (popover?.matches(":popover-open")) popover.hidePopover();
		this.#open = null;
		this.#host.requestUpdate();
	}

	/** Close an open picker, and leave a panel open. Switching the bar's mode does this, as a click away does. */
	dismissPicker(): void {
		if (this.#open && CORNER_DISMISS[this.#open] === "click-away") this.close();
	}

	/** The time offset opens the log, whose rail is where a reader moves through the run: minimized where it is not open,
	 *  and left as the reader has it where it is. It also opens playback, the controls a rail cannot offer. */
	onTimeOffsetClick = (e: Event): void => {
		const tag = SHU_TAG.MONITOR_COLUMN;
		PaneState.request({ paneType: "component", tag, label: "Monitor", ...(PaneState.has(tag) ? {} : { flag: "min" as const }) });
		this.toggle("playback")(e);
	};

	/** The one popover the corners share, its content that of the corner open. The permissions extensions are mounted
	 *  whether or not it is open, since an extension that exists only once the panel opens cannot say there is something
	 *  in it to open it for; they are shown with the access panel. */
	popoverTemplate(): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		const content =
			this.#open === "settings"
				? html`<shu-theme-switch></shu-theme-switch>`
				: this.#open === "playback"
					? html`<shu-playback></shu-playback>`
					: this.#open === "status"
						? html`<p class="status-full">${this.#status}<shu-copy-button label="copy" title="copy this message" .source=${this.#status}></shu-copy-button></p>`
						: this.#open === "access"
							? html`<shu-permissions
								data-testid=${`${prefix}permissions`}
								.level=${this.#deps.accessLevel()}
								.levels=${AccessQueryLevelSchema.options}
								.awaiting=${this.#awaiting.count}
								.awaitingRef=${this.#awaiting.ref}
								.onLevelChange=${(level: string) => this.#deps.setAccessLevel(level)}
							></shu-permissions>`
							: nothing;
		const extensions = unsafeHTML(
			getUiExtensionTags(PERMISSIONS_SLOT)
				.map((tag) => `<${tag}></${tag}>`)
				.join(""),
		);
		// A manual popover, so it stays put on a click elsewhere; the dismiss rule above closes the pickers. The click does
		// not reach the strip.
		return html`<div class="corner-popover" popover="manual" data-testid=${this.#open ? `${prefix}${this.#open}-popover` : nothing} @click=${(e: Event) => e.stopPropagation()}>${content}
			<div class="permissions-extensions" ?hidden=${this.#open !== "access"}>${extensions}</div>
		</div>`;
	}

	/** The status on the strip, shown while there is one, which opens its full text. */
	statusTemplate(): TemplateResult {
		return html`<button class="status-area" style=${this.#status ? "" : "display:none"} aria-expanded=${this.#open === "status"}
			title="what this says, in full" data-testid=${`${this.#deps.testIdPrefix()}status`} @click=${this.toggle("status")}>${this.#status}</button>`;
	}

	/** The access indicator with what the reader holds and what awaits them, the settings, and the time offset. */
	controlsTemplate(): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		const level = this.#deps.accessLevel();
		const { holds, principals, grants } = this.#summary;
		const awaiting = this.#awaiting.count;
		return html`<span class="corner-controls">
			<button class="pane-icon corner-toggle access-indicator ${awaiting > 0 ? "awaiting" : ""}" aria-label="Access level" aria-expanded=${this.#open === "access"}
				title=${`read access ${level}; ${holds} actions held, ${principals} principals, ${grants} grants${awaiting > 0 ? `; ${awaiting} awaiting your decision` : ""}`}
				data-testid=${`${prefix}access-indicator`} @click=${this.toggle("access")}>${level}
				+${holds}+${principals}+${grants}${awaiting > 0 ? html`<span class="awaiting-count" title=${`${awaiting} awaiting your decision`}>${awaiting}</span>` : nothing}</button>

			<button class="pane-icon settings-button" aria-label="Settings" aria-expanded=${this.#open === "settings"} data-testid=${`${prefix}settings-button`}
				@click=${this.toggle("settings")}>⚙</button>
			<button class="pane-icon corner-toggle time-offset" aria-label="Open the log" aria-expanded=${this.#open === "playback"}
				title="where the run is; opens the log, whose rail is where you move it from"
				data-testid=${`${prefix}time-offset`} @click=${this.onTimeOffsetClick}>${this.#timeOffset}</button>
		</span>`;
	}

	#setSummary(summary: TPermissionsSummary): void {
		this.#summary = summary;
		this.#host.requestUpdate();
	}

	#onSummary = (e: Event): void => {
		this.#setSummary((e as CustomEvent<TPermissionsSummary>).detail);
	};

	#onAwaiting = (e: Event): void => {
		const awaiting = awaitingOf((e as CustomEvent).detail);
		if (!awaiting) return;
		this.#awaiting = awaiting;
		this.#host.requestUpdate();
	};

	/** A click outside the bar closes an open picker. */
	#onDocumentClick = (e: Event): void => {
		if (!e.composedPath().includes(this.#host)) this.dismissPicker();
	};

	/** Float the popover just above the whole bar's top edge, its right edge over the control that opened it. The corner
	 *  controls sit at the bar's bottom, so a popover opening up from the strip would cover the open bar's input line. */
	#show(control: HTMLElement): void {
		const popover = this.#deps.popover();
		if (!popover) throw new Error("actions-bar: corner popover missing from the rendered template");
		popover.style.margin = "0";
		popover.style.inset = "auto";
		popover.style.bottom = `${window.innerHeight - this.#host.getBoundingClientRect().top + 4}px`;
		popover.style.left = "auto";
		popover.style.right = `${window.innerWidth - control.getBoundingClientRect().right}px`;
		popover.showPopover();
	}
}
