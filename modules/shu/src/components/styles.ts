/**
 * Cross-SHU design tokens + shared base styles.
 *
 * Every visible SHU component is required to express colour, spacing, sizing, and font through these CSS custom properties: no hard-coded colours, no ad-hoc magic numbers. The tokens cascade from `:root` (the document), so:
 *   - light/dark themes flip with a single attribute / media query, never per-component edits
 *   - user-overridable scale (`--shu-scale`) multiplies all sizing without re-rendering
 *   - portrait/narrow breakpoints adjust spacing tokens, not individual rules
 *
 * Two-layer contract: the part that makes theming work across shadow DOM:
 *   1. TOKENS are declared ONCE, at the document level, via `installShuTokens()` → `<style>` in `document.head`. CSS custom properties inherit through every shadow boundary, so a `data-theme` flip on `<html>` reaches every component for free.
 *   2. Components NEVER re-declare tokens in their own shadow root. A `:host { --shu-bg: <default> }` rule inside a shadow tree overrides the inherited value on the host and dams the cascade: the component is then stranded on the default palette regardless of the document theme. Components consume only: `static styles = [shuBaseStyles, css\`…component layout with var(--shu-…)…\`]`. The shared `shuBaseStyles` CSSResult is one constructable stylesheet lit adopts by reference into every shadow root (parsed once, not per-component).
 */

import { css, unsafeCSS, type CSSResult } from "lit";

/** Design tokens. Apply at `:host` on every shu component (and at `:root` on the page for context). Override via:
 *  - `<html data-theme="dark">` / `<shu-app data-theme="dark">` for explicit choice
 *  - `prefers-color-scheme: dark` for OS preference (falls through when no explicit choice)
 *  - `<html style="--shu-scale: 1.25">` for a user-set zoom multiplier (every size derives from `--shu-scale`).
 */
export const SHU_TOKENS = `
	:host, :root {
		--shu-scale: 1;
		--shu-space-1: calc(2px * var(--shu-scale));
		--shu-space-2: calc(4px * var(--shu-scale));
		--shu-space-3: calc(6px * var(--shu-scale));
		--shu-space-4: calc(8px * var(--shu-scale));
		--shu-space-5: calc(12px * var(--shu-scale));
		--shu-space-6: calc(16px * var(--shu-scale));
		--shu-font-xs: calc(10px * var(--shu-scale));
		--shu-font-sm: calc(11px * var(--shu-scale));
		--shu-font-md: calc(13px * var(--shu-scale));
		--shu-font-lg: calc(14px * var(--shu-scale));
		--shu-radius: 3px;
		--shu-border-w: 1px;
		--shu-icon-btn: calc(20px * var(--shu-scale));
		--shu-row-h: calc(24px * var(--shu-scale));
		--shu-input-h: calc(22px * var(--shu-scale));
		--shu-resize-w: 10px;
		--shu-scrollbar-w: 32px;
		/* A collapsed column that shows a spine view, which needs more than the rotated label's sliver. */
		--shu-spine-w: calc(44px * var(--shu-scale));
		/* The band DRAWN as a scroll rail's track. The control's own width is the press target, and is wider. */
		--shu-rail-track-w: calc(14px * var(--shu-scale));

		/* Light theme defaults */
		--shu-bg: #ffffff;
		--shu-bg-soft: #fafafa;
		--shu-bg-elevated: #f4f4f4;
		--shu-bg-input: #f0f0f0;
		--shu-bg-input-focus: #e8e8e8;
		--shu-bg-hover: rgba(0, 0, 0, 0.06);
		/* THE foreground set. Each token is a rank of emphasis, and each rank is legible: every one of these clears
		   4.5:1 against --shu-bg in BOTH themes, so choosing by MEANING can never choose an unreadable colour. Pick by
		   what the text IS, never by how light you want it to look:
		     --shu-fg          the content itself
		     --shu-fg-muted    supporting text read alongside the content (metadata, counts, captions)
		     --shu-fg-faded    text that is structure rather than content (field names, separators, placeholders)
		   Anything below 4.5:1 belongs to a BORDER token (--shu-border, --shu-border-strong), which draws lines, not
		   text. A divider drawn in a text colour and a label drawn in a border colour are the same mistake. */
		--shu-fg: #111111;
		--shu-fg-muted: #555555;
		--shu-fg-faded: #767676;
		/* Text sitting ON a type-colour swatch/chip (graph node chips, filter type labels). The palette is always light
		   pastels, so this stays dark in BOTH themes, declared only here; the dark blocks intentionally don't override it.
		   ONLY for text whose own background is a swatch: on any themed background it is dark-on-dark in the dark theme. */
		--shu-fg-on-swatch: #1a1a1a;
		--shu-border: #d0d0d0;
		--shu-border-strong: #888888;
		--shu-accent: #1a6b3c;
		--shu-accent-fg: #ffffff;
		--shu-accent-soft: #e8f5e9;
		--shu-link: #1a73e8;
		--shu-pred: #7b5ea7;
		--shu-pred-soft: #f4f0fa;
		--shu-error: #c00000;
		--shu-bg-error-soft: #fdecec;
		--shu-success: #0a8a3a;
		--shu-bg-success-soft: #d8edd8;
		--shu-warn: #b58105;
		--shu-bg-warn-soft: #fdf6e3;
		--shu-border-warn: #f0e0a0;
		--shu-info: #2848a8;
		--shu-info-fg: #ffffff;
		--shu-bg-info-soft: #d8e1f0;
		--shu-bg-info-card: #f4f7fc;
		--shu-border-info: #c8d0e0;
		--shu-private: #a01a1a;
		--shu-shadow: rgba(0, 0, 0, 0.18);
		/* 1 in dark themes: locally-rendered (black-on-white) embedded documents are colour-inverted to match. */
		--shu-invert: 0;

		--shu-font-family: ui-monospace, SFMono-Regular, Menlo, monospace;

		/* What the browser paints its own parts in: a scrollbar, a spinner, a date picker, a form control's focus ring.
		   Declared beside the tokens rather than restyled, so the parts follow the theme the way the browser renders
		   them. Without it a dark page keeps light scrollbars, which is what a white bar down a dark panel is. */
		color-scheme: light;
	}

	@media (prefers-color-scheme: dark) {
		:host, :root {
			color-scheme: dark;
			--shu-invert: 1;
			--shu-bg: #161616;
			--shu-bg-soft: #1d1d1d;
			--shu-bg-elevated: #232323;
			--shu-bg-input: #2a2a2a;
			--shu-bg-input-focus: #333333;
			--shu-bg-hover: rgba(255, 255, 255, 0.08);
			--shu-fg: #e6e6e6;
			--shu-fg-muted: #b0b0b0;
			--shu-fg-faded: #8a8a8a;
			--shu-border: #383838;
			--shu-border-strong: #5a5a5a;
			--shu-accent: #3aa367;
			--shu-accent-fg: #0e1a13;
			--shu-accent-soft: #1f3a28;
			--shu-link: #6ab7ff;
			--shu-pred: #b88ed4;
			--shu-pred-soft: #2a1f3a;
			--shu-error: #ff6868;
			--shu-bg-error-soft: #3a1f1f;
			--shu-success: #5cd28c;
			--shu-bg-success-soft: #1f3a28;
			--shu-warn: #e6b13a;
			--shu-bg-warn-soft: #3a2f1a;
			--shu-border-warn: #6a521a;
			--shu-info: #6ab7ff;
			--shu-info-fg: #0e1a2a;
			--shu-bg-info-soft: #1f2a3a;
			--shu-bg-info-card: #1a2030;
			--shu-border-info: #3a4a6a;
			--shu-private: #ff5c5c;
			--shu-shadow: rgba(0, 0, 0, 0.5);
		}
	}

	:host([data-theme="dark"]), :root[data-theme="dark"] {
		color-scheme: dark;
		--shu-invert: 1;
		--shu-bg: #161616;
		--shu-bg-soft: #1d1d1d;
		--shu-bg-elevated: #232323;
		--shu-bg-input: #2a2a2a;
		--shu-bg-input-focus: #333333;
		--shu-bg-hover: rgba(255, 255, 255, 0.08);
		--shu-fg: #e6e6e6;
		--shu-fg-muted: #b0b0b0;
		--shu-fg-faded: #8a8a8a;
		--shu-border: #383838;
		--shu-border-strong: #5a5a5a;
		--shu-accent: #3aa367;
		--shu-accent-fg: #0e1a13;
		--shu-accent-soft: #1f3a28;
		--shu-link: #6ab7ff;
		--shu-pred: #b88ed4;
		--shu-pred-soft: #2a1f3a;
		--shu-error: #ff6868;
		--shu-bg-error-soft: #3a1f1f;
		--shu-success: #5cd28c;
		--shu-bg-success-soft: #1f3a28;
		--shu-warn: #e6b13a;
		--shu-bg-warn-soft: #3a2f1a;
		--shu-border-warn: #6a521a;
		--shu-info: #6ab7ff;
		--shu-info-fg: #0e1a2a;
		--shu-bg-info-soft: #1f2a3a;
		--shu-bg-info-card: #1a2030;
		--shu-border-info: #3a4a6a;
		--shu-private: #ff5c5c;
		--shu-shadow: rgba(0, 0, 0, 0.5);
	}

	:host([data-theme="light"]), :root[data-theme="light"] {
		color-scheme: light;
		--shu-invert: 0;
		--shu-bg: #ffffff;
		--shu-bg-soft: #fafafa;
		--shu-bg-elevated: #f4f4f4;
		--shu-bg-input: #f0f0f0;
		--shu-bg-input-focus: #e8e8e8;
		--shu-bg-hover: rgba(0, 0, 0, 0.06);
		--shu-fg: #111111;
		--shu-fg-muted: #555555;
		--shu-fg-faded: #767676;
		--shu-border: #d0d0d0;
		--shu-border-strong: #888888;
		--shu-accent: #1a6b3c;
		--shu-accent-fg: #ffffff;
		--shu-accent-soft: #e8f5e9;
		--shu-link: #1a73e8;
		--shu-pred: #7b5ea7;
		--shu-pred-soft: #f4f0fa;
		--shu-error: #c00000;
		--shu-bg-error-soft: #fdecec;
		--shu-success: #0a8a3a;
		--shu-bg-success-soft: #d8edd8;
		--shu-warn: #b58105;
		--shu-bg-warn-soft: #fdf6e3;
		--shu-border-warn: #f0e0a0;
		--shu-info: #2848a8;
		--shu-info-fg: #ffffff;
		--shu-bg-info-soft: #d8e1f0;
		--shu-bg-info-card: #f4f7fc;
		--shu-border-info: #c8d0e0;
		--shu-private: #a01a1a;
		--shu-shadow: rgba(0, 0, 0, 0.18);
	}

	@media (max-width: 600px), (orientation: portrait) {
		:host, :root {
			--shu-space-1: calc(3px * var(--shu-scale));
			--shu-space-2: calc(5px * var(--shu-scale));
			--shu-space-3: calc(8px * var(--shu-scale));
			--shu-space-4: calc(10px * var(--shu-scale));
			--shu-icon-btn: calc(28px * var(--shu-scale));
			--shu-row-h: calc(32px * var(--shu-scale));
			--shu-input-h: calc(28px * var(--shu-scale));
			--shu-font-xs: calc(11px * var(--shu-scale));
			--shu-font-sm: calc(12px * var(--shu-scale));
			--shu-font-md: calc(14px * var(--shu-scale));
		}
	}
`;

/** Base reset + element defaults reused by every shu component. Tokens must be in scope (i.e. `${SHU_TOKENS}` precedes this in the template). */
export const SHU_BASE = `
	* { box-sizing: border-box; }
	:host {
		display: block;
		font-family: var(--shu-font-family);
		font-size: var(--shu-font-md);
		color: var(--shu-fg);
		line-height: 1.5;
	}
	a { color: var(--shu-link); text-decoration: none; }
	a:hover { text-decoration: underline; }
	button {
		font: inherit;
		color: var(--shu-fg);
		background: var(--shu-bg-soft);
		border: var(--shu-border-w) solid transparent;
		border-radius: var(--shu-radius);
		padding: var(--shu-space-1) var(--shu-space-3);
		cursor: pointer;
	}
	button:hover { background: var(--shu-bg-hover); }
	button.primary { background: var(--shu-accent); color: var(--shu-accent-fg); }
	button.primary:hover { filter: brightness(1.1); }
	button.icon {
		width: var(--shu-icon-btn);
		height: var(--shu-icon-btn);
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: calc(var(--shu-font-md) * 0.95);
		color: var(--shu-fg-muted);
		background: transparent;
	}
	button.icon:hover { background: var(--shu-bg-hover); color: var(--shu-fg); }
	button.icon[aria-pressed="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
	button.icon[aria-pressed="true"]:hover { filter: brightness(1.1); background: var(--shu-accent); }
	/* Text-like inputs only. checkbox/radio/range render natively: they must NOT get appearance:none + box styling, or the control becomes an empty box that never shows its checked/value state. */
	input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, .text-input {
		font: inherit;
		font-size: var(--shu-font-md);
		color: var(--shu-fg);
		background: var(--shu-bg-input);
		border: var(--shu-border-w) solid var(--shu-border);
		border-radius: var(--shu-radius);
		padding: var(--shu-space-1) var(--shu-space-3);
		outline: none;
		min-height: var(--shu-input-h);
		appearance: none;
		-webkit-appearance: none;
	}
	select {
		padding-right: calc(var(--shu-space-5) + var(--shu-space-2));
		background-image: linear-gradient(45deg, transparent 50%, var(--shu-fg-muted) 50%), linear-gradient(135deg, var(--shu-fg-muted) 50%, transparent 50%);
		background-position: calc(100% - var(--shu-space-4)) 50%, calc(100% - var(--shu-space-3)) 50%;
		background-size: 5px 5px, 5px 5px;
		background-repeat: no-repeat;
	}
	input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus, textarea:focus, select:focus { background-color: var(--shu-bg-input-focus); border-color: var(--shu-border-strong); }
	input::placeholder, textarea::placeholder { color: var(--shu-fg-faded); }
	.error { color: var(--shu-error); }
	.success { color: var(--shu-success); }
	.access-badge {
		display: inline-block;
		padding: 0 var(--shu-space-3);
		border-radius: var(--shu-radius);
		font-size: var(--shu-font-xs);
		border: var(--shu-border-w) solid var(--shu-border);
	}
	.access-badge.public { background: var(--shu-bg-soft); }
	.access-badge.opened { background: var(--shu-bg-elevated); }
	.access-badge.private { background: var(--shu-private); color: var(--shu-accent-fg); border-color: var(--shu-private); }
	.col-link { color: var(--shu-link); cursor: pointer; }
	.col-link:hover { text-decoration: underline; }
	.pred-link { color: var(--shu-pred); cursor: pointer; font-style: italic; }
	.pred-link:hover { text-decoration: underline; }
	.copy-btn { background: none; border: none; padding: 0 var(--shu-space-1); font-size: var(--shu-font-lg); cursor: pointer; opacity: 0.6; color: var(--shu-fg-muted); }
	.copy-btn:hover, .copy-btn.copied { opacity: 1; }
	code { font-family: var(--shu-font-family); background: var(--shu-bg-elevated); padding: 0 var(--shu-space-2); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); color: var(--shu-fg); }
	.muted { color: var(--shu-fg-muted); font-size: var(--shu-font-sm); }
	.faded { color: var(--shu-fg-faded); }
	.empty { color: var(--shu-fg-faded); font-style: italic; font-size: var(--shu-font-sm); padding: var(--shu-space-3) 0; }
	.tag {
		display: inline-block;
		padding: 0 var(--shu-space-3);
		border-radius: var(--shu-radius);
		font-size: var(--shu-font-sm);
		background: var(--shu-bg-elevated);
		color: var(--shu-fg-muted);
		border: var(--shu-border-w) solid transparent;
	}
	.tag.success { background: var(--shu-bg-success-soft); color: var(--shu-success); }
	.tag.warn { background: var(--shu-bg-warn-soft); color: var(--shu-warn); }
	.tag.error { background: var(--shu-bg-error-soft); color: var(--shu-error); }
	.tag.info { background: var(--shu-bg-info-soft); color: var(--shu-info); }
	.tag.pred { background: var(--shu-pred-soft); color: var(--shu-pred); }
	.banner { padding: var(--shu-space-3) var(--shu-space-4); border-radius: var(--shu-radius); margin: var(--shu-space-2) 0; font-size: var(--shu-font-sm); display: flex; align-items: center; gap: var(--shu-space-4); }
	.banner.error { background: var(--shu-bg-error-soft); color: var(--shu-error); border: var(--shu-border-w) solid var(--shu-error); }
	.banner.warn { background: var(--shu-bg-warn-soft); color: var(--shu-warn); border: var(--shu-border-w) solid var(--shu-border-warn); }
	.banner.info { background: var(--shu-bg-info-soft); color: var(--shu-info); border: var(--shu-border-w) solid var(--shu-border-info); }
	.card { padding: var(--shu-space-4) var(--shu-space-5); margin: var(--shu-space-2) 0; border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); background: var(--shu-bg-soft); }
	.card.success { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-success); }
	.card.warn { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-warn); }
	.card.error { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-error); }
	.card.info { border-left: calc(var(--shu-border-w) * 4) solid var(--shu-info); }
	.future-event { opacity: 0.4; }
	/* A JSON value as disclosures: what holds parts indents under what it belongs to, and a name reads before its value.
	   The disclosure itself is the browser's, styled no further than the indent that shows what belongs to what. */
	.json-disclosure { margin: 0 0 0 var(--shu-space-2); }
	.json-line { margin: 0 0 0 var(--shu-space-3); }
	.json-name { color: var(--shu-fg-faded); }
	.json-holds { color: var(--shu-fg-faded); font-size: 0.85em; }
	.json-value { white-space: pre-wrap; overflow-wrap: anywhere; }
	.json-said { margin-bottom: var(--shu-space-1); }
	.time-current { background: var(--shu-accent-soft); border-left: calc(var(--shu-border-w) * 3) solid var(--shu-accent); }
`;

/** The shared base sheet as a lit `CSSResult`, for `static styles = [shuBaseStyles, css\`…\`]`. One object across all components → lit builds the constructable `CSSStyleSheet` once and adopts it by reference into every shadow root (one parse, N light adoptions). Consumers only, no token declarations, so it never dams the document-level theme cascade. String-injecting shadow roots (manual `innerHTML`, template `<style>`) use the `SHU_BASE` string form instead. */
export const shuBaseStyles: CSSResult = css`${unsafeCSS(SHU_BASE)}`;

/** The standard small icon button: the column pane's min/max/gear/pin/close controls, and any other control that
 * should look like them (e.g. the actions bar's pin and corner toggles). A square scaled button, bordered, muted;
 * `aria-pressed="true"` (a toggle) or `aria-expanded="true"` (a disclosure/popover control) renders the active accent
 * fill. Shared so an active control shows identically everywhere. */
export const SHU_ICON_BUTTON = `
	button.pane-icon {
		width: calc(16px * var(--shu-scale));
		height: calc(16px * var(--shu-scale));
		padding: 0;
		margin: 0;
		display: inline-flex;
		align-items: center; justify-content: center;
		font: inherit;
		font-size: calc(12px * var(--shu-scale));
		line-height: 1;
		color: var(--shu-fg-muted);
		background: var(--shu-bg);
		border: var(--shu-border-w) solid var(--shu-border);
		border-radius: var(--shu-radius);
		cursor: pointer;
		flex-shrink: 0;
		vertical-align: middle;
	}
	button.pane-icon:hover {
		color: var(--shu-fg);
		background: var(--shu-bg-hover);
		border-color: var(--shu-border-strong);
	}
	button.pane-icon[aria-pressed="true"],
	button.pane-icon[aria-expanded="true"] {
		color: var(--shu-accent-fg);
		background: var(--shu-accent);
		border-color: var(--shu-accent);
	}
	button.pane-icon[aria-pressed="true"]:hover,
	button.pane-icon[aria-expanded="true"]:hover { filter: brightness(1.1); }
`;
export const shuIconButtonStyles: CSSResult = css`${unsafeCSS(SHU_ICON_BUTTON)}`;

/** A row whose children are each a distinct control: a rule between them, so the row reads as separate settings rather
 *  than a run of words. Takes the row's selector, since a light-DOM host scopes its rules by tag and a shadow-DOM
 *  component does not: one declaration either way. */
export const shuRowSeparated = (selector: string): string => `${selector} > * + * { border-left: var(--shu-border-w) solid var(--shu-border); padding-left: var(--shu-space-3); }`;

/** Inject the token sheet into `document.head` so detached overlays (combobox dropdowns, tooltips, modals rendered into document.body) and any plain page chrome can read the same `--shu-…` variables that shadow-DOM components inherit via :host. Idempotent, repeat calls are no-ops. The SPA boot calls this once before any component mounts. */
export function installShuTokens(): void {
	if (typeof document === "undefined") return;
	const ID = "shu-tokens-root";
	if (document.getElementById(ID)) return;
	const sheet = document.createElement("style");
	sheet.id = ID;
	sheet.textContent = SHU_TOKENS;
	document.head.appendChild(sheet);
}
