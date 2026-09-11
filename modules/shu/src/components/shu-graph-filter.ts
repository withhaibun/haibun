/**
 * <shu-graph-filter>: type checkbox legend + per-type sample-limit slider
 * shared by every graph view. Hosts publish their raw data via `setSource`;
 * on change, the component dispatches `graph-filter-change` with
 * `{ overrides, perTypeLimit }` (the user's explicit per-type show/hide choices;
 * hosts combine them with the instrumentation-default predicate). Bubbles +
 * composed so any ancestor can listen.
 *
 * Time-aware. The filter is itself a `ShuElement`, so it receives TIME_SYNC
 * directly and derives the visible cluster list from the host's snapshot
 * (`knownClusters`) plus the time-filtered subset of the host's quads. Hosts
 * call `setSource` whenever the data changes; the filter handles cursor moves
 * on its own. The shared projection lives in `graph-filter-projection.ts`.
 *
 * Visible only when the host carries `show-controls`: the column-pane's
 * settings toggle is the single switch for revealing every settings surface.
 */
import { html, css, unsafeCSS, type TemplateResult } from "lit";
import { z } from "zod";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles, shuRowSeparated } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { DEFAULT_PER_TYPE_LIMIT, MAX_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { colorForType } from "../type-colors.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { clamp } from "../util.js";
import { readElementPrefs } from "../element-prefs.js";
import { projectFilterClusters, effectiveHiddenTypes, derivePredicates, explicitlyHidden } from "../graph-filter-projection.js";
import { isSchemaType, ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "../graph/ontology-projection.js";
import "./shu-chip-group.js";
import "./shu-field.js";
import type { TChip } from "./shu-chip-group.js";

const StateSchema = z.object({
	// The user's EXPLICIT per-type visibility choices (true = shown, false = hidden). A type absent here follows the
	// instrumentation-default predicate. Persisted, and combined with that default via effectiveHiddenTypes.
	// Storing only deliberate choices, never a seeded default, is what lets a default change re-apply and prevents
	// writing the default irreversibly into the user's cookie.
	overrides: z.record(z.string(), z.boolean()).default({}),
	// The user's explicit per-PREDICATE visibility choices (false = the edges drawn for that predicate are hidden).
	// A predicate absent here is shown; only deliberate choices are stored, exactly as with the type overrides.
	predicateOverrides: z.record(z.string(), z.boolean()).default({}),
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
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; padding: var(--shu-space-2) var(--shu-space-4); font-size: var(--shu-font-md); background: var(--shu-bg); }
			:host { border-bottom: var(--shu-border-w) solid var(--shu-border); }
			:host(:not([show-controls])) { display: none; }
			.row { display: flex; gap: var(--shu-space-3); align-items: center; flex-wrap: wrap; }
			${unsafeCSS(shuRowSeparated(".row"))}
			/* A rule off the chips, so the graph's own options read as their own thing rather than the tail of the legend. */
			.row.view-settings { margin-top: var(--shu-space-2); padding-top: var(--shu-space-2); border-top: var(--shu-border-w) solid var(--shu-border); }
			.row[hidden] { display: none; }
			/* The limit slider needs a width to be draggable; every other control sizes itself. */
			input[type=range] { width: 120px; }
			.quad-count { color: var(--shu-fg-faded); }
			.solo { cursor: pointer; background: var(--shu-bg); color: var(--shu-fg); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: var(--shu-space-1) var(--shu-space-2); line-height: 1; }
			.solo[aria-pressed="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
			:host([data-solo-waiting]) shu-chip-group { cursor: crosshair; }
		`,
	];

	/** The hidden/limit choice is remembered across reloads (ShuElement.persistFields). The default key is shared by every
	 *  embedded filter of the main graph; a host whose choices must stay independent (a class browser scoped to the schema)
	 *  sets `data-persist-scope`, giving its filter its own store. */
	static persistFields = ["overrides", "predicateOverrides", "perTypeLimit"] as const;

	protected override get persistKey(): string {
		return this.dataset.persistScope ?? "";
	}

	/** Hosts read this before their first fetch so the persisted overrides apply on initial load (no double round-trip).
	 * Reads the same persistFields store the instance restores from (per `scope`, matching `data-persist-scope`). Hosts
	 * combine these overrides with the instrumentation-default predicate via `effectiveHiddenTypes`: the default is
	 * never persisted here. */
	static getPersistedFilter(scope = ""): { overrides: Record<string, boolean>; hiddenPredicates: string[]; perTypeLimit: number } {
		const saved = readElementPrefs("shu-graph-filter", scope);
		const parsed = StateSchema.safeParse(saved ?? {});
		if (!parsed.success) return { overrides: {}, hiddenPredicates: [], perTypeLimit: DEFAULT_PER_TYPE_LIMIT };
		return { overrides: parsed.data.overrides, hiddenPredicates: explicitlyHidden(parsed.data.predicateOverrides), perTypeLimit: parsed.data.perTypeLimit };
	}

	private knownClusters = new Map<string, TCluster>();
	private quads: TQuad[] = [];
	// Axis mode: alternative to quad/cluster source. When set, the filter renders
	// one section of checkboxes per named axis (e.g. stepper, kind) and emits
	// `graph-filter-change` with `{ hiddenByAxis }`. Used by the chain-graph view
	// where the data is `TGraph`-shaped, not quad-shaped.
	private axisSource: { axes: Record<string, string[]>; hidden: Record<string, Set<string>> } | null = null;
	private axisCookieKey: string | null = null;
	// Transient UI for the 1️⃣ tool: while it waits, the next chip press, a type or a property, shows ONLY that one
	// instead of toggling it. One press's state, not a durable choice, so it is kept off persistFields.
	private soloWaiting = false;

	constructor() {
		// persistFields restores overrides/perTypeLimit on connect; defaults until then.
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

	/** Show ONLY these types (the rest hidden), driving the SAME change path a legend click takes, so the legend,
	 * the host's data refetch, and persistence all stay in sync. For graph-control steps that scope the view. */
	setVisibleTypes(types: string[]): void {
		const keep = new Set(types);
		const overrides = { ...this.state.overrides };
		for (const t of this.knownClusters.keys()) overrides[t] = keep.has(t);
		this.setState({ overrides });
		this.dispatchChange();
	}

	/** Show or hide the edges of the named predicates: the same change path the properties chips take. */
	setPredicateVisibility(predicates: string[], visible: boolean): void {
		const predicateOverrides = { ...this.state.predicateOverrides };
		for (const pr of predicates) predicateOverrides[pr] = visible;
		this.setState({ predicateOverrides });
		this.dispatchChange();
	}

	/** Reveal or hide SPECIFIC types without touching the others' visibility: the additive counterpart to setVisibleTypes
	 *  (which is show-only). Ticking a default-hidden type (the merged schema's Class/Property) reveals it ALONGSIDE the
	 *  live data, exactly as ticking its chip does. */
	setTypeVisibility(types: string[], visible: boolean): void {
		const overrides = { ...this.state.overrides };
		for (const t of types) overrides[t] = visible;
		this.setState({ overrides });
		this.dispatchChange();
	}

	/**
	 * A scene's remembered choices, announced as every other change to them is. The host derives what the graph shows
	 * from the filter's report rather than by reading its state, so choices restored silently would leave the legend
	 * saying one thing and the graph showing another.
	 */
	override applySceneState(fields: Record<string, unknown>): void {
		super.applySceneState(fields);
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
		// overrides/perTypeLimit persist automatically via setState (persistFields); the dispatch just notifies hosts, which
		// combine the overrides with the instrumentation-default predicate (effectiveHiddenTypes) to decide what renders.
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.GRAPH_FILTER_CHANGE, {
				detail: { overrides: this.state.overrides, hiddenPredicates: this.hiddenPredicates(), perTypeLimit: this.state.perTypeLimit },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Hovering a type label previews it, broadcast so the graph views dim the other types. null ends the preview. */
	private previewType(type: string | null): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_TYPE_PREVIEW, { detail: { type }, bubbles: true, composed: true }));
	}

	/** The predicates whose edges are hidden: the explicit unticks; everything else shows. */
	private hiddenPredicates(): string[] {
		return explicitlyHidden(this.state.predicateOverrides);
	}

	private onPredicateToggle = (predicate: string, checked: boolean): void => {
		if (this.soloWaiting) {
			this.endSoloWait();
			this.setVisiblePredicates([predicate]); // show only this predicate's edges: the same gesture a type takes
			return;
		}
		this.setPredicateVisibility([predicate], checked);
	};

	/** The tool acts once: it stops waiting as it answers, so the next chip press is an ordinary tick. */
	private endSoloWait(): void {
		this.soloWaiting = false;
		this.toggleAttribute("data-solo-waiting", false);
		this.requestUpdate();
	}

	/** Show ONLY these predicates' edges: every other predicate in the data is hidden. The solo tool's answer for a
	 *  property chip, and the counterpart of setVisibleTypes. */
	setVisiblePredicates(predicates: string[]): void {
		const keep = new Set(predicates);
		const predicateOverrides = { ...this.state.predicateOverrides };
		for (const { predicate } of derivePredicates(this.filterByTime(this.quads))) predicateOverrides[predicate] = keep.has(predicate);
		this.setState({ predicateOverrides });
		this.dispatchChange();
	}

	private deriveClusters(visibleQuads: TQuad[]): TCluster[] {
		return projectFilterClusters({ knownClusters: this.knownClusters, allQuads: this.quads, visibleQuads, timeCursor: this.timeCursor });
	}

	private clampLimit(raw: string): number {
		return clamp(Math.round(parseInt(raw, 10)), 1, MAX_PER_TYPE_LIMIT);
	}

	/** A host slotting its options after this filter first rendered, re-render, so the settings row appears with them.
	 *  A CSS-only gate cannot stand in: `:host(:has([slot="view-settings"]))` does not match here, and the row then stays
	 *  hidden with every option rendered inside it. */
	private onViewSettingsSlotChange = (): void => this.requestUpdate();

	/** Track the drag so the value label follows the handle; the refetch waits for the release (onLimitChange). */
	private onLimitInput = (e: Event): void => {
		this.setState({ perTypeLimit: this.clampLimit((e.target as HTMLInputElement).value) });
	};

	private onLimitChange = (e: Event): void => {
		this.setState({ perTypeLimit: this.clampLimit((e.target as HTMLInputElement).value) });
		this.dispatchChange();
	};

	/** A host-driven raise (the +N-more cluster expand) goes through the SAME change path a slider release takes:
	 *  the filter owns the limit, persists it, and its dispatch drives the host's one refetch handler. */
	raiseLimitTo(perTypeLimit: number): void {
		this.setState({ perTypeLimit: clamp(perTypeLimit, 1, MAX_PER_TYPE_LIMIT) });
		this.dispatchChange();
	}

	/** The "solo" tool: press it, then a type or property chip, and only that one shows (the rest hide). */
	private toggleSolo = (): void => {
		this.soloWaiting = !this.soloWaiting;
		// The waiting cue covers every chip group in the row, so it rides the host rather than one group's row.
		this.toggleAttribute("data-solo-waiting", this.soloWaiting);
		this.requestUpdate();
	};

	render(): TemplateResult {
		// A filter serves ONE source. An axis host (setAxes) offers the values of each grouping axis; a quad host
		// (setSource) offers the data's types and properties. The controls that belong to quads: the per-type limit,
		// the solo tool, the quad count, go with that source, never to a host with no quads to count.
		if (this.axisSource) return this.rows(Object.entries(this.axisSource.axes).map(([axis, values]) => this.axisRow(axis, values)));
		const visibleQuads = this.filterByTime(this.quads); // ONE time-filtered pass, shared by the clusters, the predicates and the count
		const clusters = this.deriveClusters(visibleQuads)
			.slice()
			.sort((a, b) => a.type.localeCompare(b.type));
		// Chip checked = effectively visible: the user's explicit override, else the instrumentation-default predicate. One source.
		const hiddenTypes = new Set(
			effectiveHiddenTypes(
				clusters.map((c) => c.type),
				this.state.overrides,
			),
		);
		const typeChip = (c: TCluster): TChip => ({
			id: c.type,
			label: c.type,
			checked: !hiddenTypes.has(c.type),
			color: colorForType(c.type),
			...(c.totalCount > 0 ? { count: c.totalCount } : {}),
		});
		// A schema-scoped host (`data-schema-only`, the class browser) filters the vocabulary itself: the legend carries
		// only the Class + Property chips. The instance-data controls are absent: they have no subject when no instance
		// type is offered.
		if (this.dataset.schemaOnly !== undefined)
			return this.rows([
				html`<shu-chip-group name="schema" .chips=${clusters.filter((c) => isSchemaType(c.type)).map(typeChip)} .onToggle=${this.onChipToggle} .onPreview=${this.onChipPreview}></shu-chip-group>`,
			]);
		// The data types and the schema terms are different kinds of thing: the types get chips; the whole schema
		// (classes & predicates) reveals through ONE toggle, since its two term kinds show together or not at all.
		const schemaClusters = clusters.filter((c) => isSchemaType(c.type));
		const schemaShown = schemaClusters.length > 0 && schemaClusters.every((c) => !hiddenTypes.has(c.type));
		const hiddenPreds = new Set(this.hiddenPredicates());
		const predicateChips = derivePredicates(visibleQuads).map((p): TChip => ({ id: p.predicate, label: p.predicate, checked: !hiddenPreds.has(p.predicate), count: p.count }));
		return this.rows([
			html`<shu-chip-group name="types" .chips=${clusters.filter((c) => !isSchemaType(c.type)).map(typeChip)} .onToggle=${this.onChipToggle} .onPreview=${this.onChipPreview}></shu-chip-group>
				<button type="button" class="solo" data-testid="graph-filter-solo" aria-pressed=${this.soloWaiting} title="solo: press this, then a type or property chip, to show only that one" @click=${this.toggleSolo}>1️⃣</button>`,
			html`<shu-chip-group name="properties" .chips=${predicateChips} .onToggle=${this.onPredicateToggle}></shu-chip-group>`,
			html`<shu-field label="classes &amp; predicates" trailing>
					<input type="checkbox" data-testid="graph-filter-schema" .checked=${schemaShown} @change=${this.onSchemaToggle} />
				</shu-field>
				<shu-field label="per-type limit">
					<input type="range" min="10" max=${MAX_PER_TYPE_LIMIT} step="10" .value=${String(this.state.perTypeLimit)} @input=${this.onLimitInput} @change=${this.onLimitChange} />
					<span class="meta" data-testid="graph-filter-limit-value">${this.state.perTypeLimit}</span>
				</shu-field>
				<span class="quad-count">${visibleQuads.length} quads</span>`,
		]);
	}

	/** The rows a mode offers, each on its own line, with the host's view-settings slot last: the one page shape every
	 *  mode renders, so a mode decides only WHAT it offers. */
	private rows(rows: TemplateResult[]): TemplateResult {
		return html`${rows.map((row) => html`<div class="row">${row}</div>`)}
			<div class="row view-settings" ?hidden=${!this.querySelector('[slot="view-settings"]')}>
				<slot name="view-settings" @slotchange=${this.onViewSettingsSlotChange}></slot>
			</div>`;
	}

	/** One grouping axis as its own chip group: its values, each shown or hidden. */
	private axisRow(axis: string, values: string[]): TemplateResult {
		const hidden = this.axisSource?.hidden[axis] ?? new Set<string>();
		const chips = values
			.slice()
			.sort((a, b) => a.localeCompare(b))
			.map((v): TChip => ({ id: v, label: v, checked: !hidden.has(v), color: colorForType(v) }));
		return html`<shu-chip-group name=${axis} .chips=${chips} .onToggle=${this.onAxisToggle(axis)}></shu-chip-group>`;
	}

	/** A type chip through the shared group element: the solo tool intercepts the toggle exactly as it intercepted a
	 *  chip click, so the 1-tool works the same through the reusable chips. */
	private onChipToggle = (type: string, checked: boolean): void => {
		if (this.soloWaiting) {
			this.endSoloWait();
			this.setVisibleTypes([type]); // show only this type, via the same change path a legend click takes
			return;
		}
		this.setTypeVisibility([type], checked);
	};

	private onChipPreview = (type: string | null): void => this.previewType(type);

	/** The one classes-&-predicates toggle: the two schema term kinds reveal together or hide together. */
	private onSchemaToggle = (e: Event): void => {
		const on = (e.target as HTMLInputElement).checked;
		this.setTypeVisibility([ONTOLOGY_CLASS, ONTOLOGY_PROPERTY], on);
	};

	private onAxisToggle =
		(axis: string) =>
		(value: string, checked: boolean): void => {
			if (!this.axisSource) return;
			const set = this.axisSource.hidden[axis] ?? new Set<string>();
			if (checked) set.delete(value);
			else set.add(value);
			this.axisSource.hidden[axis] = set;
			this.requestUpdate();
			this.dispatchChange();
		};
}

if (!customElements.get("shu-graph-filter")) {
	customElements.define("shu-graph-filter", ShuGraphFilter);
}
