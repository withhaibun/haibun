/**
 * <shu-graph-filter> — type checkbox legend + per-type sample-limit slider
 * shared by every graph view. Hosts publish their raw data via `setSource`;
 * on change, the component dispatches `graph-filter-change` with
 * `{ types, perTypeLimit }`. Bubbles + composed so any ancestor can listen.
 *
 * Time-aware. The filter is itself a `ShuElement`, so it receives TIME_SYNC
 * directly and derives the visible cluster list from the host's snapshot
 * (`knownClusters`) plus the time-filtered subset of the host's quads. Hosts
 * call `setSource` whenever the data changes; the filter handles cursor moves
 * on its own. The shared projection lives in `graph-filter-projection.ts`.
 *
 * Visible only when the host carries `show-controls` — the column-pane's
 * settings toggle is the single switch for revealing every settings surface.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { colorForType } from "../type-colors.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { readElementPrefs } from "../element-prefs.js";
import { projectFilterClusters } from "../graph-filter-projection.js";

const StateSchema = z.object({
	hiddenTypes: z.array(z.string()).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
});

// The per-axis hidden-set (chain-graph mode) is a separate keyed store, not this component's own state, so it
// keeps its own namespaced cookie rather than going through persistFields.
const AXIS_COOKIE_PREFIX = "shu-graph-filter-axes";

function readAxisCookie(key: string): Record<string, string[]> {
	const parsed = getJsonCookie<Record<string, unknown> | null>(`${AXIS_COOKIE_PREFIX}-${key}`, null);
	if (!parsed || typeof parsed !== "object") return {};
	const out: Record<string, string[]> = {};
	for (const [axis, values] of Object.entries(parsed)) {
		if (Array.isArray(values)) out[axis] = values.filter((v): v is string => typeof v === "string");
	}
	return out;
}

function writeAxisCookie(key: string, value: Record<string, string[]>): void {
	setJsonCookie(`${AXIS_COOKIE_PREFIX}-${key}`, value);
}

export class ShuGraphFilter extends ShuElement<typeof StateSchema> {
	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; padding: var(--shu-space-2) var(--shu-space-4); font-size: var(--shu-font-md); background: var(--shu-bg); }
			:host { border-bottom: var(--shu-border-w) solid var(--shu-border); }
			:host(:not([show-controls])) { display: none; }
			.row { display: flex; gap: var(--shu-space-3); align-items: center; flex-wrap: wrap; }
			label.type { display: inline-flex; align-items: center; gap: var(--shu-space-2); cursor: pointer; color: var(--shu-fg); }
			label.type { padding: var(--shu-space-1) var(--shu-space-3); border-radius: var(--shu-radius); }
			label.type input[type=checkbox] { margin: 0; vertical-align: middle; flex-shrink: 0; }
			label.type:hover { filter: brightness(0.95); }
			label.type .meta { color: var(--shu-fg-muted); font-size: var(--shu-font-sm); opacity: 0.85; }
			.limit { display: inline-flex; gap: var(--shu-space-2); align-items: center; }
			.limit input[type=range] { width: 120px; }
			.label { color: var(--shu-fg-muted); }
			.quad-count { color: var(--shu-fg-faded); }
		`,
	];

	/** The hidden/limit choice is remembered across reloads (ShuElement.persistFields; singleton key shared by every embedded filter). */
	static persistFields = ["hiddenTypes", "perTypeLimit"] as const;

	/** Hosts read this before their first fetch so the persisted filter applies on initial load (no double round-trip). Reads the same persistFields store the instance restores from, validated to the schema's defaults. */
	static getPersistedFilter(): { hiddenTypes: string[]; perTypeLimit: number } {
		const saved = readElementPrefs("shu-graph-filter", "");
		const parsed = StateSchema.safeParse(saved ?? {});
		return parsed.success ? { hiddenTypes: parsed.data.hiddenTypes, perTypeLimit: parsed.data.perTypeLimit } : { hiddenTypes: [], perTypeLimit: DEFAULT_PER_TYPE_LIMIT };
	}

	private knownClusters = new Map<string, TCluster>();
	private quads: TQuad[] = [];
	// Axis mode: alternative to quad/cluster source. When set, the filter renders
	// one section of checkboxes per named axis (e.g. stepper, kind) and emits
	// `graph-filter-change` with `{ hiddenByAxis }`. Used by the chain-graph view
	// where the data is `TGraph`-shaped, not quad-shaped.
	private axisSource: { axes: Record<string, string[]>; hidden: Record<string, Set<string>> } | null = null;
	private axisCookieKey: string | null = null;

	constructor() {
		// persistFields restores hiddenTypes/perTypeLimit on connect; defaults until then.
		super(StateSchema, {});
	}

	/**
	 * Publish the host's current data. Hosts call this whenever the snapshot
	 * arrives or the quad set changes; the filter takes it from there and
	 * re-derives its legend on every TIME_SYNC.
	 */
	setSource(knownClusters: Map<string, TCluster>, quads: TQuad[]): void {
		this.knownClusters = knownClusters;
		this.quads = quads;
		this.axisSource = null;
		this.requestUpdate();
	}

	/** Show ONLY these types (the rest hidden), driving the SAME change path a legend click takes — so the legend,
	 * the host's data refetch, and persistence all stay in sync. For graph-control steps that scope the view. */
	setVisibleTypes(types: string[]): void {
		const keep = new Set(types);
		this.setState({ hiddenTypes: [...this.knownClusters.keys()].filter((t) => !keep.has(t)) });
		this.dispatchChange();
	}

	/**
	 * Axis-mode source. The chain-graph view supplies pre-computed axes (stepper,
	 * kind, etc.) instead of quads; the filter renders one row of checkboxes per
	 * axis and emits `graph-filter-change` with `{ hiddenByAxis }`. The host
	 * attribute `data-axis-cookie-key` namespaces persistence so different chain
	 * views remember their own filters.
	 */
	setAxes(axes: Record<string, string[]>): void {
		const cookieKey = this.dataset.axisCookieKey ?? "default";
		this.axisCookieKey = cookieKey;
		const persisted = readAxisCookie(cookieKey);
		const hidden: Record<string, Set<string>> = {};
		for (const axis of Object.keys(axes)) hidden[axis] = new Set(persisted[axis] ?? []);
		this.axisSource = { axes, hidden };
		this.requestUpdate();
	}

	/** Hosts call this before their first paint so the persisted hidden-set applies on initial load. */
	static getPersistedAxes(cookieKey: string): Record<string, string[]> {
		return readAxisCookie(cookieKey);
	}

	private dispatchChange(): void {
		if (this.axisSource) {
			const hiddenByAxis: Record<string, string[]> = {};
			for (const [axis, set] of Object.entries(this.axisSource.hidden)) hiddenByAxis[axis] = [...set];
			if (this.axisCookieKey) writeAxisCookie(this.axisCookieKey, hiddenByAxis);
			this.dispatchEvent(
				new CustomEvent(SHU_EVENT.GRAPH_FILTER_CHANGE, {
					detail: { hiddenByAxis },
					bubbles: true,
					composed: true,
				}),
			);
			return;
		}
		// hiddenTypes/perTypeLimit persist automatically via setState (persistFields); the dispatch just notifies hosts.
		const visibleClusters = this.deriveClusters();
		const visibleTypes = visibleClusters.map((c) => c.type).filter((t) => !this.state.hiddenTypes.includes(t));
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.GRAPH_FILTER_CHANGE, {
				detail: { types: visibleTypes, perTypeLimit: this.state.perTypeLimit },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Hovering a type label previews it — broadcast so the graph views dim the other types. null ends the preview. */
	private previewType(type: string | null): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_TYPE_PREVIEW, { detail: { type }, bubbles: true, composed: true }));
	}

	private deriveClusters(): TCluster[] {
		const visibleQuads = this.filterByTime(this.quads);
		return projectFilterClusters({ knownClusters: this.knownClusters, allQuads: this.quads, visibleQuads, timeCursor: this.timeCursor });
	}

	private onTypeChange =
		(type: string) =>
		(e: Event): void => {
			const hidden = new Set(this.state.hiddenTypes);
			if ((e.target as HTMLInputElement).checked) hidden.delete(type);
			else hidden.add(type);
			this.setState({ hiddenTypes: [...hidden] });
			this.dispatchChange();
		};

	private onLimitChange = (e: Event): void => {
		const clamped = Math.max(1, Math.min(10000, Math.round(parseInt((e.target as HTMLInputElement).value, 10))));
		if (clamped === this.state.perTypeLimit) return;
		this.setState({ perTypeLimit: clamped });
		this.dispatchChange();
	};

	private onAxisChange =
		(axis: string, value: string) =>
		(e: Event): void => {
			if (!this.axisSource) return;
			const set = this.axisSource.hidden[axis] ?? new Set<string>();
			if ((e.target as HTMLInputElement).checked) set.delete(value);
			else set.add(value);
			this.axisSource.hidden[axis] = set;
			this.dispatchChange();
			this.requestUpdate();
		};

	render(): TemplateResult {
		if (this.axisSource) {
			return html`${Object.entries(this.axisSource.axes).map(([axis, values]) => {
				const hidden = this.axisSource?.hidden[axis] ?? new Set<string>();
				return html`<div class="row"><span class="label">${axis}:</span>${values
					.slice()
					.sort((a, b) => a.localeCompare(b))
					.map(
						(v) =>
							html`<label class="type" style=${`background:${colorForType(v)}`}><input type="checkbox" .checked=${!hidden.has(v)} @change=${this.onAxisChange(axis, v)}>${v}</label>`,
					)}${values.length === 0 ? html`<span class="meta">none</span>` : ""}</div>`;
			})}`;
		}
		const { hiddenTypes, perTypeLimit } = this.state;
		const hiddenSet = new Set(hiddenTypes);
		const clusters = this.deriveClusters()
			.slice()
			.sort((a, b) => a.type.localeCompare(b.type));
		const quadCount = this.filterByTime(this.quads).length;
		return html`<div class="row">
			<span class="label">show:</span>
			${
				clusters.length === 0
					? html`<span class="meta">no types loaded</span>`
					: clusters.map((c) => {
							const omitted =
								c.omittedCount > 0
									? html` <span class="meta">(${c.sampledCount}/${c.totalCount})</span>`
									: c.totalCount > 0
										? html` <span class="meta">(${c.totalCount})</span>`
										: "";
							return html`<label class="type" style=${`background:${colorForType(c.type)}`} @mouseenter=${() => this.previewType(c.type)} @mouseleave=${() => this.previewType(null)}><input type="checkbox" .checked=${!hiddenSet.has(c.type)} @change=${this.onTypeChange(c.type)}>${c.type}${omitted}</label>`;
						})
			}
			<span class="label">|</span>
			<label class="limit">per-type limit
				<input type="range" min="10" max="1000" step="10" .value=${String(perTypeLimit)} @change=${this.onLimitChange}>
			</label>
			<span class="quad-count">${quadCount} quads</span>
		</div>`;
	}
}

if (!customElements.get("shu-graph-filter")) {
	customElements.define("shu-graph-filter", ShuGraphFilter);
}
