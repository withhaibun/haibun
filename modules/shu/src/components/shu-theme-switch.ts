/**
 * <shu-theme-switch> — Theme + scale control cluster, shown in the actions bar's settings popover.
 *
 * Sets `data-theme` on documentElement (resolved by SHU_TOKENS via :root[data-theme="…"])
 * and writes `--shu-scale` as a custom property on the root, which every SHU component
 * picks up through `calc(N * var(--shu-scale))` in its tokens. Persists via localStorage.
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { ThemeSwitchSchema } from "../schemas.js";
import { persistedSetting } from "../signals.js";

const STORAGE_THEME = "shu.theme";
const STORAGE_SCALE = "shu.scale";
const STORAGE_WINDOW_SIZE = "shu.windowSize";

/** First-run fallback theme / UI scale — named consts (never bare literals), each a member of THEMES / SCALES. */
const DEFAULT_THEME = "auto";
const DEFAULT_SCALE = "1";

const THEMES = [
	{ value: DEFAULT_THEME, label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const;

const SCALES = [
	{ value: "0.85", label: "S" },
	{ value: DEFAULT_SCALE, label: "M" },
	{ value: "1.25", label: "L" },
	{ value: "1.5", label: "XL" },
] as const;

/** First-run fallback rows per windowed view — a named const (never a bare literal), and a member of WINDOW_SIZES. */
const DEFAULT_WINDOW_SIZE = "500";

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

type Theme = (typeof THEMES)[number]["value"];

// All three global UI settings go through the one persistedSetting mechanism (localStorage + a reactive signal) so they
// can't drift into bespoke wiring. Theme/scale apply via the DOM; the window size is read by every windowed view.
const themeSetting = persistedSetting(STORAGE_THEME, DEFAULT_THEME, (v) => THEMES.some((t) => t.value === v));
const scaleSetting = persistedSetting(STORAGE_SCALE, DEFAULT_SCALE, (v) => Number.isFinite(Number.parseFloat(v)));
const windowSizeSetting = persistedSetting(STORAGE_WINDOW_SIZE, DEFAULT_WINDOW_SIZE, (v) => WINDOW_SIZES.some((w) => w.value === v));

function readTheme(): Theme {
	return themeSetting.get() as Theme;
}
function readScale(): string {
	return scaleSetting.get();
}

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

/** Apply persisted theme + scale at boot, before any component mounts. Call from app.ts after installShuTokens(). */
export function applyShuPreferences(): void {
	const root = document.documentElement;
	const theme = readTheme();
	if (theme === "auto") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
	root.style.setProperty("--shu-scale", readScale());
}

export class ShuThemeSwitch extends ShuElement<typeof ThemeSwitchSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host {
			display: inline-flex; align-items: center; gap: var(--shu-space-2);
			flex-wrap: wrap;
			color: var(--shu-fg);
			font: inherit; font-size: var(--shu-font-sm);
			user-select: none;
		}
		.group {
			display: inline-flex;
			border: var(--shu-border-w) solid var(--shu-border);
			border-radius: var(--shu-radius);
			overflow: hidden;
		}
		.group + .group { margin-left: var(--shu-space-3); }
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
		.group > button[aria-pressed="true"] {
			background: var(--shu-accent);
			color: var(--shu-accent-fg);
		}
		.group > button:hover:not([aria-pressed="true"]) { background: var(--shu-bg-hover); color: var(--shu-fg); }
		.label { color: var(--shu-fg-muted); padding: 0 var(--shu-space-2); }
	`,
	];

	constructor() {
		super(ThemeSwitchSchema, { theme: readTheme(), scale: readScale(), windowSize: windowSizeSetting.get() });
	}

	private setTheme = (theme: Theme): void => {
		this.setState({ ...this.state, theme });
		themeSetting.set(theme);
		const root = document.documentElement;
		if (theme === "auto") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", theme);
	};

	private setScale = (scale: string): void => {
		this.setState({ ...this.state, scale });
		scaleSetting.set(scale);
		document.documentElement.style.setProperty("--shu-scale", scale);
	};

	private setWindowSize = (windowSize: string): void => {
		this.setState({ ...this.state, windowSize });
		windowSizeSetting.set(windowSize); // persists + re-renders every windowed view that reads getWindowSize()
	};

	render(): TemplateResult {
		const { theme, scale, windowSize } = this.state;
		return html`
			<span class="label">theme</span>
			<span class="group" role="group" aria-label="Theme">
				${THEMES.map((t) => html`<button type="button" aria-pressed=${t.value === theme} @click=${() => this.setTheme(t.value)}>${t.label}</button>`)}
			</span>
			<span class="label">size</span>
			<span class="group" role="group" aria-label="Scale">
				${SCALES.map((s) => html`<button type="button" aria-pressed=${s.value === scale} @click=${() => this.setScale(s.value)}>${s.label}</button>`)}
			</span>
			<span class="label">window</span>
			<span class="group" role="group" aria-label="Window size" data-testid="settings-window-size">
				${WINDOW_SIZES.map((w) => html`<button type="button" data-value=${w.value} aria-pressed=${w.value === windowSize} @click=${() => this.setWindowSize(w.value)}>${w.label}</button>`)}
			</span>
		`;
	}
}
