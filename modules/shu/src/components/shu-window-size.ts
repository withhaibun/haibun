/**
 * <shu-window-size> — the window-size picker (rows held/shown per windowed view), bound to the ONE global
 * `windowSizeSetting`. It renders wherever the setting is worth changing: the settings popover, and embedded in a
 * view's window-cut notice so a person who hits the cut can widen the window right there instead of being left
 * hanging. The current value is read reactively from the shared signal, so every mounted picker stays in step.
 *
 * This module also owns the setting itself and the two read helpers every windowed view uses (`getWindowSize`,
 * `windowTail`) — one home for the whole windowing concern.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { persistedSetting } from "../signals.js";

const STORAGE_WINDOW_SIZE = "shu.windowSize";

/** First-run fallback rows per windowed view — a named const (never a bare literal), and a member of WINDOW_SIZES. */
export const DEFAULT_WINDOW_SIZE = "500";

/** Rows held/shown per windowed view (query results, the event log). One global setting; each view scrolls its own position within it. `∞` (9e9) is effectively unlimited. */
const WINDOW_SIZES = [
	{ value: "50", label: "50" },
	{ value: DEFAULT_WINDOW_SIZE, label: DEFAULT_WINDOW_SIZE },
	{ value: "2000", label: "2000" },
	{ value: "5000", label: "5000" },
	{ value: "10000", label: "10000" },
	{ value: "20000", label: "20000" },
	{ value: "9000000000", label: "∞" },
] as const;

/** The one global window-size setting. Exported alongside its reader `getWindowSize` so the picker element and tests
 *  drive the same handle rather than reaching into storage. */
export const windowSizeSetting = persistedSetting(STORAGE_WINDOW_SIZE, DEFAULT_WINDOW_SIZE, (v) => WINDOW_SIZES.some((w) => w.value === v));

/** The global window size (rows per windowed view), read reactively so a settings change re-renders every windowed view. */
export function getWindowSize(): number {
	return Number.parseInt(windowSizeSetting.get(), 10);
}

/** A generous tail window of a list — the last `getWindowSize()` items (the whole list if smaller). The shared bound every
 *  windowed view applies; over-fetched (the browser handles thousands of rows), so it's a safety cap, not virtualization. */
export function windowTail<T>(items: T[]): T[] {
	const size = getWindowSize();
	return items.length > size ? items.slice(items.length - size) : items;
}

const EmptySchema = z.object({});

export class ShuWindowSize extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): unknown | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = "shu-window-size";

	static styles = [
		shuBaseStyles,
		css`
		:host { display: inline-flex; align-items: center; font-size: var(--shu-font-sm); user-select: none; }
		.group {
			display: inline-flex;
			border: var(--shu-border-w) solid var(--shu-border);
			border-radius: var(--shu-radius);
			overflow: hidden;
		}
		.group > button {
			padding: var(--shu-space-1) var(--shu-space-3);
			background: transparent;
			color: var(--shu-fg-muted);
			border: none;
			border-left: var(--shu-border-w) solid var(--shu-border);
			cursor: pointer;
			font: inherit; font-size: var(--shu-font-sm);
			min-width: 24px;
		}
		.group > button:first-child { border-left: none; }
		.group > button[aria-pressed="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
		.group > button:hover:not([aria-pressed="true"]) { background: var(--shu-bg-hover); color: var(--shu-fg); }
	`,
	];

	constructor() {
		super(EmptySchema, {});
	}

	render(): TemplateResult {
		const current = windowSizeSetting.get(); // reactive: any picker (or the setting itself) changing re-renders this one
		return html`<span class="group" role="group" aria-label="Window size" data-testid="settings-window-size">
			${WINDOW_SIZES.map((w) => html`<button type="button" data-value=${w.value} aria-pressed=${w.value === current} @click=${() => windowSizeSetting.set(w.value)}>${w.label}</button>`)}
		</span>`;
	}
}

customElements.define("shu-window-size", ShuWindowSize);
