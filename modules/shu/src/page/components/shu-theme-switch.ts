/**
 * <shu-theme-switch>: the theme and scale controls of the actions bar's settings. It sets `data-theme` on the document's
 * root element, which `SHU_TOKENS` reads through `:root[data-theme="…"]`, and the `--shu-scale` property, which every
 * component's tokens multiply. It stores both under its tag, and the page applies them at its start (`applyStoredTheme`).
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, type PropertyValues, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles, shuSegmentedStyles } from "./styles.js";
import { INITIAL_THEME, PAGE_SETTING_KEY, SCALES, THEMES, ThemeSwitchSchema, type TThemeSettings } from "../domains/settings.js";
import { readSetting } from "../controllers/setting-controller.js";
import "./shu-window-size.js";

/** Sets the theme and the scale on the document's root element. The `auto` theme doesn't set a theme, so the page follows
 *  the operating system's preference. */
function applyTheme({ theme, scale }: TThemeSettings): void {
	if (theme === "auto") document.documentElement.removeAttribute("data-theme");
	else document.documentElement.setAttribute("data-theme", theme);
	document.documentElement.style.setProperty("--shu-scale", scale);
}

/** Applies the stored theme and scale before a component mounts. The page's start calls it after `installShuTokens`. */
export function applyStoredTheme(): void {
	applyTheme(readSetting(SHU_TAG.THEME_SWITCH, ThemeSwitchSchema, INITIAL_THEME));
}

class ShuThemeSwitch extends ShuElement<typeof ThemeSwitchSchema> {
	/** A control doesn't contribute to the Kihan's context, since it isn't a view of data. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		shuSegmentedStyles,
		css`
		:host {
			display: inline-flex; align-items: center; gap: var(--shu-space-2);
			flex-wrap: wrap;
			color: var(--shu-fg);
			font: inherit; font-size: var(--shu-font-sm);
			user-select: none;
		}
		.group + .group { margin-left: var(--shu-space-3); }
		.label { color: var(--shu-fg-muted); padding: 0 var(--shu-space-2); }
	`,
	];

	static persistFields = ["theme", "scale"] as const;

	constructor() {
		super(ThemeSwitchSchema, INITIAL_THEME);
	}

	protected override get persistKey(): string {
		return PAGE_SETTING_KEY;
	}

	protected override updated(changed: PropertyValues): void {
		super.updated(changed);
		if (changed.has("state")) applyTheme(this.state);
	}

	render(): TemplateResult {
		const { theme, scale } = this.state;
		return html`
			<span class="label">theme</span>
			<span class="group" role="group" aria-label="Theme">
				${THEMES.map((t) => html`<button type="button" aria-pressed=${t.value === theme} @click=${() => this.setState({ theme: t.value })}>${t.label}</button>`)}
			</span>
			<span class="label">size</span>
			<span class="group" role="group" aria-label="Scale">
				${SCALES.map((s) => html`<button type="button" aria-pressed=${s.value === scale} @click=${() => this.setState({ scale: s.value })}>${s.label}</button>`)}
			</span>
			<span class="label">window</span>
			<shu-window-size></shu-window-size>
		`;
	}
}

defineElement(SHU_TAG.THEME_SWITCH, ShuThemeSwitch);
