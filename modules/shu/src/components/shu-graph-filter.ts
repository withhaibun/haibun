/**
 * <shu-graph-filter> — type checkbox legend + per-type sample-limit slider
 * shared by graph views. Hosts publish the available types via `setClusters`
 * (and optionally a quad count via `setQuadCount`); on change the component
 * dispatches `graph-filter-change` with `{ types, perTypeLimit }`. Bubbles +
 * composed so any ancestor can listen.
 *
 * Visible only when the host carries `show-controls` — the column-pane's
 * settings toggle is the single switch for revealing every settings surface.
 */
import { z } from "zod";
import type { TCluster } from "@haibun/core/lib/quad-types.js";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { colorForType } from "../type-colors.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";

const StateSchema = z.object({
	clusters: z.array(z.object({ type: z.string(), totalCount: z.number(), sampledCount: z.number(), omittedCount: z.number(), sampledSubjects: z.array(z.string()) })).default([]),
	hiddenTypes: z.array(z.string()).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
	quadCount: z.number().int().nonnegative().default(0),
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

	constructor() {
		const persisted = readCookie();
		super(StateSchema, {
			clusters: [],
			hiddenTypes: persisted?.hiddenTypes ?? [],
			perTypeLimit: persisted?.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT,
			quadCount: 0,
		});
	}

	setClusters(clusters: TCluster[]): void {
		this.setState({ clusters });
	}

	setQuadCount(quadCount: number): void {
		if (quadCount === this.state.quadCount) return;
		this.setState({ quadCount });
	}

	private dispatchChange(): void {
		writeCookie({ hiddenTypes: this.state.hiddenTypes, perTypeLimit: this.state.perTypeLimit });
		const visibleTypes = this.state.clusters.map((c) => c.type).filter((t) => !this.state.hiddenTypes.includes(t));
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.GRAPH_FILTER_CHANGE, {
				detail: { types: visibleTypes, perTypeLimit: this.state.perTypeLimit },
				bubbles: true,
				composed: true,
			}),
		);
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { clusters, hiddenTypes, perTypeLimit, quadCount } = this.state;
		const hiddenSet = new Set(hiddenTypes);
		const typeChecks = clusters
			.slice()
			.sort((a, b) => a.type.localeCompare(b.type))
			.map((c) => {
				const omitted = c.omittedCount > 0 ? ` <span class="meta">(${c.sampledCount}/${c.totalCount})</span>` : c.totalCount > 0 ? ` <span class="meta">(${c.totalCount})</span>` : "";
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
