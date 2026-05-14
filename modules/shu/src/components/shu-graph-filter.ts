/**
 * <shu-graph-filter> — type checkbox legend + per-type sample-limit slider
 * shared by every graph view. Hosts publish their raw data via `setSource`;
 * on change, the component dispatches `graph-filter-change` with
 * `{ types, perTypeLimit }`. Bubbles + composed so any ancestor can listen.
 *
 * Time-aware. The filter is itself a `ShuElement`, so it receives TIME_SYNC
 * directly and derives the visible cluster list from the host's snapshot
 * (`knownClusters`) plus the time-filtered subset of the host's quads. Hosts
 * no longer wire their own `onTimeSync` to push fresh clusters — they call
 * `setSource` whenever the data changes and the filter handles cursor moves
 * on its own. The shared projection lives in `graph-filter-projection.ts`.
 *
 * Visible only when the host carries `show-controls` — the column-pane's
 * settings toggle is the single switch for revealing every settings surface.
 */
import { z } from "zod";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { colorForType } from "../type-colors.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { projectFilterClusters } from "../graph-filter-projection.js";

const StateSchema = z.object({
	hiddenTypes: z.array(z.string()).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
});

const COOKIE_NAME = "shu-graph-filter";

type Persisted = { hiddenTypes: string[]; perTypeLimit: number };

function readCookie(): Persisted | null {
	const parsed = getJsonCookie<Partial<Persisted> | null>(COOKIE_NAME, null);
	if (!parsed) return null;
	const hiddenTypes = Array.isArray(parsed.hiddenTypes) ? parsed.hiddenTypes.filter((t) => typeof t === "string") : [];
	const perTypeLimit = typeof parsed.perTypeLimit === "number" && parsed.perTypeLimit > 0 ? Math.floor(parsed.perTypeLimit) : DEFAULT_PER_TYPE_LIMIT;
	return { hiddenTypes, perTypeLimit };
}

function writeCookie(value: Persisted): void {
	setJsonCookie(COOKIE_NAME, value);
}

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

const STYLES = `
:host { display: block; padding: 4px 8px; font-size: 12px; background: #fff; border-bottom: 1px solid #ddd; }
:host(:not([show-controls])) { display: none; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
/* Each type is a coloured chip — checkbox + label both inside, tight spacing. */
label.type { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 1px 6px; border-radius: 3px; color: #222; }
label.type input[type=checkbox] { margin: 0; vertical-align: middle; flex-shrink: 0; }
label.type:hover { filter: brightness(0.95); }
label.type .meta { color: #555; font-size: 11px; opacity: 0.85; }
.limit { display: inline-flex; gap: 4px; align-items: center; }
.limit input[type=range] { width: 120px; }
.label { color: #666; }
.quad-count { color: #888; }
`;

export class ShuGraphFilter extends ShuElement<typeof StateSchema> {
	/** Hosts read this before their first fetch so the persisted filter applies on initial load (no double round-trip). */
	static getPersistedFilter(): { hiddenTypes: string[]; perTypeLimit: number } {
		const persisted = readCookie();
		return { hiddenTypes: persisted?.hiddenTypes ?? [], perTypeLimit: persisted?.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT };
	}

	private knownClusters = new Map<string, TCluster>();
	private quads: TQuad[] = [];
	private docTimeSyncAbort?: AbortController;
	// Axis mode: alternative to quad/cluster source. When set, the filter renders
	// one section of checkboxes per named axis (e.g. stepper, kind) and emits
	// `graph-filter-change` with `{ hiddenByAxis }`. Used by the chain-graph view
	// where the data is `TGraph`-shaped, not quad-shaped.
	private axisSource: { axes: Record<string, string[]>; hidden: Record<string, Set<string>> } | null = null;
	private axisCookieKey: string | null = null;

	constructor() {
		const persisted = readCookie();
		super(StateSchema, {
			hiddenTypes: persisted?.hiddenTypes ?? [],
			perTypeLimit: persisted?.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT,
		});
	}

	connectedCallback(): void {
		super.connectedCallback();
		// The timeline lives in a different shadow tree, so its TIME_SYNC reaches
		// document but never enters this filter's host shadow root via natural
		// propagation. Listen at the document level so the filter is time-aware
		// wherever it's mounted. ShuElement's per-instance listener still fires
		// when a host explicitly dispatches TIME_SYNC into its own shadow, so
		// guard against the double-handle by skipping events that already
		// bubbled through `this`.
		this.docTimeSyncAbort?.abort();
		this.docTimeSyncAbort = new AbortController();
		document.addEventListener(
			SHU_EVENT.TIME_SYNC,
			(e) => {
				const ce = e as CustomEvent;
				if (ce.composedPath().includes(this)) return;
				if (this.hasAttribute("data-snapshot-time")) return;
				this.timeCursor = ce.detail?.currentTime ?? null;
				this.onTimeSync(this.timeCursor);
			},
			{ signal: this.docTimeSyncAbort.signal },
		);
	}

	disconnectedCallback(): void {
		this.docTimeSyncAbort?.abort();
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
		this.render();
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
		this.render();
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
		writeCookie({ hiddenTypes: this.state.hiddenTypes, perTypeLimit: this.state.perTypeLimit });
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

	private deriveClusters(): TCluster[] {
		const visibleQuads = this.filterByTime(this.quads);
		return projectFilterClusters({ knownClusters: this.knownClusters, allQuads: this.quads, visibleQuads, timeCursor: this.timeCursor });
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		if (this.axisSource) {
			this.renderAxes();
			return;
		}
		const { hiddenTypes, perTypeLimit } = this.state;
		const hiddenSet = new Set(hiddenTypes);
		const clusters = this.deriveClusters();
		const quadCount = this.filterByTime(this.quads).length;
		const typeChecks = clusters
			.slice()
			.sort((a, b) => a.type.localeCompare(b.type))
			.map((c) => {
				const omitted =
					c.omittedCount > 0 ? ` <span class="meta">(${c.sampledCount}/${c.totalCount})</span>` : c.totalCount > 0 ? ` <span class="meta">(${c.totalCount})</span>` : "";
				return `<label class="type" style="background:${colorForType(c.type)}"><input type="checkbox" data-type="${c.type}" ${hiddenSet.has(c.type) ? "" : "checked"}>${c.type}${omitted}</label>`;
			})
			.join("");
		this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="row">
			<span class="label">show:</span>
			${typeChecks || '<span class="meta">no types loaded</span>'}
			<span class="label">|</span>
			<label class="limit">per-type limit
				<input type="range" min="10" max="1000" step="10" value="${perTypeLimit}" data-action="limit-range">
			</label>
			<span class="quad-count">${quadCount} quads</span>
		</div>`;
		this.bind();
	}

	private renderAxes(): void {
		if (!this.shadowRoot || !this.axisSource) return;
		const rows = Object.entries(this.axisSource.axes)
			.map(([axis, values]) => {
				const hidden = this.axisSource?.hidden[axis] ?? new Set<string>();
				const chips = values
					.slice()
					.sort((a, b) => a.localeCompare(b))
					.map((v) => `<label class="type" style="background:${colorForType(v)}"><input type="checkbox" data-axis="${axis}" data-value="${v.replace(/"/g, "&quot;")}" ${hidden.has(v) ? "" : "checked"}>${v}</label>`)
					.join("");
				return `<div class="row"><span class="label">${axis}:</span>${chips || '<span class="meta">none</span>'}</div>`;
			})
			.join("");
		this.shadowRoot.innerHTML = `${this.css(STYLES)}${rows}`;
		for (const cb of Array.from(this.shadowRoot.querySelectorAll<HTMLInputElement>("input[data-axis]"))) {
			cb.addEventListener("change", () => {
				const axis = cb.dataset.axis ?? "";
				const value = cb.dataset.value ?? "";
				if (!this.axisSource) return;
				const set = this.axisSource.hidden[axis] ?? new Set<string>();
				if (cb.checked) set.delete(value);
				else set.add(value);
				this.axisSource.hidden[axis] = set;
				this.dispatchChange();
			});
		}
	}

	private bind(): void {
		const root = this.shadowRoot;
		if (!root) return;
		root.querySelectorAll<HTMLInputElement>("input[data-type]").forEach((cb) => {
			cb.addEventListener("change", () => {
				const type = cb.dataset.type ?? "";
				const hidden = new Set(this.state.hiddenTypes);
				if (cb.checked) hidden.delete(type);
				else hidden.add(type);
				this.setState({ hiddenTypes: [...hidden] });
				this.dispatchChange();
			});
		});
		const range = root.querySelector<HTMLInputElement>("input[data-action='limit-range']");
		range?.addEventListener("change", () => {
			const clamped = Math.max(1, Math.min(10000, Math.round(parseInt(range.value, 10))));
			if (clamped === this.state.perTypeLimit) return;
			this.setState({ perTypeLimit: clamped });
			this.dispatchChange();
		});
	}
}

if (!customElements.get("shu-graph-filter")) {
	customElements.define("shu-graph-filter", ShuGraphFilter);
}
