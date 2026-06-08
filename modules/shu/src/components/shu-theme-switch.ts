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

const STORAGE_THEME = "shu.theme";
const STORAGE_SCALE = "shu.scale";

const THEMES = [
	{ value: "auto", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const;

const SCALES = [
	{ value: "0.85", label: "S" },
	{ value: "1", label: "M" },
	{ value: "1.25", label: "L" },
	{ value: "1.5", label: "XL" },
] as const;

type Theme = (typeof THEMES)[number]["value"];

function readTheme(): Theme {
	const v = localStorage.getItem(STORAGE_THEME) as Theme | null;
	return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}
function readScale(): string {
	const v = localStorage.getItem(STORAGE_SCALE);
	return v && Number.isFinite(Number.parseFloat(v)) ? v : "1";
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
		super(ThemeSwitchSchema, { theme: readTheme(), scale: readScale() });
	}

	private setTheme = (theme: Theme): void => {
		this.setState({ theme, scale: this.state.scale });
		localStorage.setItem(STORAGE_THEME, theme);
		const root = document.documentElement;
		if (theme === "auto") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", theme);
	};

	private setScale = (scale: string): void => {
		this.setState({ theme: this.state.theme, scale });
		localStorage.setItem(STORAGE_SCALE, scale);
		document.documentElement.style.setProperty("--shu-scale", scale);
	};

	render(): TemplateResult {
		const { theme, scale } = this.state;
		return html`
			<span class="label">theme</span>
			<span class="group" role="group" aria-label="Theme">
				${THEMES.map((t) => html`<button type="button" aria-pressed=${t.value === theme} @click=${() => this.setTheme(t.value)}>${t.label}</button>`)}
			</span>
			<span class="label">size</span>
			<span class="group" role="group" aria-label="Scale">
				${SCALES.map((s) => html`<button type="button" aria-pressed=${s.value === scale} @click=${() => this.setScale(s.value)}>${s.label}</button>`)}
			</span>
		`;
	}
}
