/**
 * The shared view head both graph hosts render — one pattern, one look: ONE row of icons above the graph, in three
 * kinds. Actions act at once (fit, copy). State toggles hold a state and show it pressed (follow, prune, the 🧭
 * guide). Settings groups are exclusive disclosure: pressing one opens its row of controls under the head, pressing
 * another moves the row there, pressing the open one closes it — so the head stays one row and every option is one
 * press away. The glyphs are monochrome technical characters, never coloured emoji, so the row reads as instrument
 * controls rather than decoration.
 *
 * The hosts are light-DOM (their A-Frame scene resolves the camera through document), so the CSS is emitted per
 * host tag rather than shadow-scoped. The flex column rides an inner .view-root wrapper, not the host tag itself —
 * a mount may set the host's display inline (e.g. display:block), which would silently kill a tag-level flex.
 */
import { html, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import type { ShuCopyButton } from "./shu-copy-button.js";
import { SHU_ICON_BUTTON, shuRowSeparated } from "./styles.js";

/** The settings groups a host can offer, in row order. Each is a disclosure: its icon opens its controls row. */
export type TSettingsGroup = "layout" | "filters" | "scenes";
export const SETTINGS_GROUPS: ReadonlyArray<{ group: TSettingsGroup; glyph: string; title: string }> = [
	// How the graph is laid out is one choice made of several: which way it is faced, what it reads as, how it gathers,
	// and what places depth. Split across three icons a reader set one and went looking for the next.
	{ group: "layout", glyph: "∠", title: "layout: orientation, the view, grouping, depth" },
	{ group: "filters", glyph: "∇", title: "filters: types, properties, limits" },
	{ group: "scenes", glyph: "☆", title: "scenes: save this way of looking, return to one" },
];
/** The group names alone, so a schema (or any other consumer) derives its values from this catalog rather than
 *  restating them. */
export const SETTINGS_GROUP_NAMES = SETTINGS_GROUPS.map((g) => g.group) as [TSettingsGroup, ...TSettingsGroup[]];

export function viewHeadCss(host: string): string {
	return `
	${host} .view-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
	${host} .view-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: var(--shu-space-2); padding: var(--shu-space-2) var(--shu-space-3) 0; border-bottom: var(--shu-border-w) solid var(--shu-border); }
	${host} .view-controls { display: flex; align-items: center; gap: var(--shu-space-2); font-size: var(--shu-font-sm); color: var(--shu-fg); padding-bottom: var(--shu-space-1); }
	${host} .view-controls button, ${host} .view-controls select, ${host} .settings-row button, ${host} .settings-row select { background: var(--shu-bg-soft); color: var(--shu-fg); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); font: inherit; font-size: var(--shu-font-sm); padding: var(--shu-space-1) var(--shu-space-3); cursor: pointer; }
	/* A control that carries a word keeps the row's own button face; its pressed state is the shared accent fill. */
	${host} .view-controls button[aria-pressed="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
	/* A control whose face is a GLYPH is the shu icon button — the same square, hover and pressed fill the pane's own
	   min/max/settings controls use, so an active control looks the same wherever it is. */
	${SHU_ICON_BUTTON}
	${host} .view-controls label, ${host} .settings-row label { display: inline-flex; align-items: center; gap: var(--shu-space-1); }
	/* Every control on a settings row shares one centre line whatever its intrinsic height is; <shu-field> names them. */
	${host} .settings-row input, ${host} .settings-row shu-field { vertical-align: middle; }
	${shuRowSeparated(`${host} .settings-row`)}
	/* The open group's controls, on their own row under the head. */
	${host} .settings-row { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: var(--shu-space-3); font-size: var(--shu-font-sm); color: var(--shu-fg); padding: var(--shu-space-2) var(--shu-space-3); border-bottom: var(--shu-border-w) solid var(--shu-border); background: var(--shu-bg-soft); }
	${host} .graph-area { position: relative; flex: 1 1 auto; min-height: 0; }
	${host} .graph-area shu-graph-scene { position: absolute; inset: 0; display: block; }
`;
}

/**
 * The one icon row. Every host gets the actions (⛶ fit, ⧉ copy — a graph never frames itself, and the copy source is
 * provided lazily so the graph serializes only when the person actually copies). A host with persisted layout choices
 * (the fisheye) also passes its state toggles and its settings groups; the class browser's layout is fixed, so it
 * passes `rotate` instead — its two head-on aims stay on its head, since it has no orientation row to hold them.
 *
 * Each host passes its own ids: both hosts can be on the page at once, and one shared id would make a query ambiguous.
 */
/** One head toggle: what it is called, how it shows, and what pressing it means. */
export type TViewToggle = { id: string; glyph: string; label?: string; title: string; on: boolean; onToggle: (on: boolean) => void };

/** THE pressed-state button of the head — one shape for a settings group and a view toggle alike. A glyph-only face is
 *  the shared icon button; a face with a word keeps the row's button look. */
function iconToggle(b: { id: string; glyph: string; label?: string; title: string; on: boolean; press: () => void }): TemplateResult {
	return html`<button type="button" class=${b.label ? "" : "pane-icon"} data-testid=${b.id} title=${b.title} aria-pressed=${b.on} @click=${b.press}>
		${b.label ? `${b.glyph} ${b.label}` : b.glyph}
	</button>`;
}

/** The two head-on aims, wherever they are offered: on a host's head (the class browser) or inside the fisheye's
 *  orientation settings row. One definition, so the wording and the behaviour cannot drift between them. */
export function rotateControls(o: { xyId: string; zId: string; onRotate: (aim: "xy" | "z") => void }): TemplateResult {
	return html`<button type="button" data-testid=${o.xyId} title="rotate to face the layout plane" @click=${() => o.onRotate("xy")}>xy</button>
		<button type="button" data-testid=${o.zId} title="rotate to face the depth axis (time reads left to right)" @click=${() => o.onRotate("z")}>z</button>`;
}

export function viewActions(o: {
	fitId: string;
	copyId: string;
	onFit: () => void;
	getCopyText: () => string;
	/** The head-on rotations on the head itself — for a host without an orientation settings group. */
	rotate?: { xyId: string; zId: string; onRotate: (aim: "xy" | "z") => void };
	/** The stateful view toggles, in row order: each holds a state and shows it pressed. A glyph-only face reads as an
	 *  icon button; a face with a word keeps the row's button look. */
	toggles?: ReadonlyArray<TViewToggle>;
	/** The exclusive settings groups: at most one open; its controls row renders under the head (host-owned). */
	settings?: { openGroup: TSettingsGroup | null; idFor: (group: TSettingsGroup) => string; onGroup: (group: TSettingsGroup | null) => void };
}): TemplateResult {
	const bindProvider = (el?: Element): void => {
		if (el) (el as ShuCopyButton).sourceProvider = o.getCopyText;
	};
	const s = o.settings;
	return html`<button type="button" data-testid=${o.fitId} title="fit the whole graph in view" @click=${o.onFit}>⛶ fit</button>
		${(o.toggles ?? []).map((t) => iconToggle({ id: t.id, glyph: t.glyph, label: t.label, title: t.title, on: t.on, press: () => t.onToggle(!t.on) }))}
		${
			s
				? SETTINGS_GROUPS.map(({ group, glyph, title }) =>
						iconToggle({ id: s.idFor(group), glyph, title, on: s.openGroup === group, press: () => s.onGroup(s.openGroup === group ? null : group) }),
					)
				: ""
		}
		${o.rotate ? rotateControls(o.rotate) : ""}
		<shu-copy-button data-testid=${o.copyId} label="⧉" title="copy the graph to the clipboard" ${ref(bindProvider)}></shu-copy-button>`;
}
