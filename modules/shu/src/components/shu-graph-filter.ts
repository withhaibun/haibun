/**
 * <shu-graph-filter> — type checkbox list + per-type sample limit slider
 * shared by graph views. Hosts publish the available types via attributes
 * or `setClusters`; on change the component dispatches `graph-filter-change`
 * with `{ types, perTypeLimit }`. Bubbles + composed so any ancestor can listen.
 */
import { z } from "zod";
import type { TCluster } from "@haibun/core/lib/quad-types.js";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../quads-snapshot.js";

const StateSchema = z.object({
	clusters: z.array(z.object({ type: z.string(), totalCount: z.number(), sampledCount: z.number(), omittedCount: z.number(), sampledSubjects: z.array(z.string()) })).default([]),
	hiddenTypes: z.array(z.string()).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
});

const COOKIE_NAME = "shu-graph-filter";

type Persisted = { hiddenTypes: string[]; perTypeLimit: number };

function readCookie(): Persisted | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
	if (!match) return null;
	try {
		const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<Persisted>;
		const hiddenTypes = Array.isArray(parsed.hiddenTypes) ? parsed.hiddenTypes.filter((t) => typeof t === "string") : [];
		const perTypeLimit = typeof parsed.perTypeLimit === "number" && parsed.perTypeLimit > 0 ? Math.floor(parsed.perTypeLimit) : DEFAULT_PER_TYPE_LIMIT;
		return { hiddenTypes, perTypeLimit };
	} catch {
		return null;
	}
}

function writeCookie(value: Persisted): void {
	if (typeof document === "undefined") return;
	document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

const STYLES = `
:host { display: block; padding: 4px 8px; font-size: 12px; background: #fff; border-bottom: 1px solid #ddd; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
label.type { display: inline-flex; gap: 3px; align-items: center; cursor: pointer; padding: 1px 4px; border-radius: 3px; }
label.type:hover { background: #f0f0f0; }
label.type .meta { color: #888; font-size: 11px; }
.limit { display: inline-flex; gap: 4px; align-items: center; }
.limit input[type=range] { width: 120px; }
.limit input[type=number] { width: 56px; }
.label { color: #666; }
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
		});
	}

	setClusters(clusters: TCluster[]): void {
		this.setState({ clusters });
	}

	connectedCallback(): void {
		super.connectedCallback();
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
		const { clusters, hiddenTypes, perTypeLimit } = this.state;
		const hiddenSet = new Set(hiddenTypes);
		const typeChecks = clusters
			.slice()
			.sort((a, b) => a.type.localeCompare(b.type))
			.map((c) => {
				const omitted = c.omittedCount > 0 ? ` <span class="meta">(${c.sampledCount}/${c.totalCount})</span>` : ` <span class="meta">(${c.totalCount})</span>`;
				return `<label class="type"><input type="checkbox" data-type="${c.type}" ${hiddenSet.has(c.type) ? "" : "checked"}> ${c.type}${omitted}</label>`;
			})
			.join("");
		this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="row">
			<span class="label">show:</span>
			${typeChecks || '<span class="meta">no types loaded</span>'}
			<span class="label">|</span>
			<label class="limit">per-type limit
				<input type="range" min="10" max="1000" step="10" value="${perTypeLimit}" data-action="limit-range">
				<input type="number" min="1" max="10000" step="10" value="${perTypeLimit}" data-action="limit-number">
			</label>
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
		const number = root.querySelector<HTMLInputElement>("input[data-action='limit-number']");
		const sync = (val: number) => {
			const clamped = Math.max(1, Math.min(10000, Math.round(val)));
			if (clamped === this.state.perTypeLimit) return;
			this.setState({ perTypeLimit: clamped });
			this.dispatchChange();
		};
		range?.addEventListener("change", () => sync(parseInt(range.value, 10)));
		number?.addEventListener("change", () => sync(parseInt(number.value, 10)));
	}
}

if (!customElements.get("shu-graph-filter")) {
	customElements.define("shu-graph-filter", ShuGraphFilter);
}
