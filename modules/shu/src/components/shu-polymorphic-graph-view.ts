import { SHU_TEST_IDS } from "../test-ids.js";
import { html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { SHU_EVENT } from "../consts.js";
import type { ShuGraphFilter } from "./shu-graph-filter.js";
import { conduit } from "../hypermedia.js";
import { applyScene, captureScene, listScenes, readScene, saveScene, type TSceneState } from "../scenes.js";
import { SCENE_LABEL } from "@haibun/core/lib/resources.js";

/** The time a reader is looking at, held in a scene beside the views' own options. It is not an element's option but the shared time signal, so it is recorded under its own key. */
const TIME_CURSOR_KEY = "time-cursor";

const POLYMORPHIC_IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { VIEW, VIEW_TYPES } from "../graph/polymorphic/polymorphic-views.js";
import { type TPolymorphicOptionChange } from "./shu-polymorphic-settings.js";
import type { TViewForces } from "../graph/polymorphic/polymorphic-render-type.js";
import "./shu-polymorphic-settings.js";
import { viewHeadCss, viewActions, rotateControls, SETTINGS_GROUP_NAMES, type TSettingsGroup } from "./view-head.js";
import { ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "../graph/ontology-projection.js";
import "@haibun/shu/graph/polymorphic/polymorphic-scene.js";

import {
	type ShuGraphScene,
	type FGInstance,
	GRAPH_SCENE_EVENT,
	type GraphSceneModel,
	type GraphSceneConfig,
	type GraphSceneChangedDetail,
	type RescheduleUpdate,
} from "../graph/polymorphic/polymorphic-scene.js";

// A cursor move re-styles (depth re-place, positions pinned) — cheap, so it paints promptly. NOT the streamed-data
// window (which would stack to ~1s); the base coalesces continuous scrubbing to this before it reaches onTimeCursorPaint.
const CURSOR_COALESCE_MS = 100;

// Composed statically and rendered via unsafeHTML: lit leaves bindings inside a <style> element uninterpolated,
// so the shared view-head rules cannot be interpolated in the template itself.
const FISHEYE_CSS = `
	shu-polymorphic-graph-view { display: block; width: 100%; height: 100%; overflow: hidden; background: var(--shu-bg); }
	shu-polymorphic-graph-view shu-graph-filter { flex: 0 0 auto; }
	${viewHeadCss("shu-polymorphic-graph-view")}
	shu-polymorphic-graph-view #polymorphic-counts { color: var(--shu-fg-muted); }
	/* Latest step: inline in the head after the counts. Hidden when no SeqPath is visible. */
	shu-polymorphic-graph-view #polymorphic-step { max-width: 30ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--shu-fg); color: var(--shu-bg); padding: var(--shu-space-1) var(--shu-space-3); border-radius: var(--shu-radius); font-weight: 600; }
	shu-polymorphic-graph-view #polymorphic-step[hidden] { display: none; }
	/* Saved views are about the whole view, so they take their own line under the options rather than trailing them. */
	shu-polymorphic-graph-view .polymorphic-scenes { flex-basis: 100%; display: flex; align-items: center; gap: var(--shu-space-2); margin-top: var(--shu-space-1); }
	shu-polymorphic-graph-view .polymorphic-scenes .error { color: var(--shu-fg-error); }
`;

const PolymorphicStateSchema = z.object({
	...clusteredGraphStateShape,
	viewType: z.enum(VIEW_TYPES).default(VIEW.force),
	flatten: z.boolean().default(false),
	grouped: z.boolean().default(false),
	groupBy: z.string().default("type"), // axis: "type" (@type), "role" (highest-priority actor), or an actor predicate (a rel)
	/** What places depth (z): the object's valid time (the catalog's validTimeField), its indexed time (generatedAtTime), or its number of connections. */
	zBasis: z.enum(["valid", "indexed", "connections"]).default("valid"),
	/** Label chips with each node's z factor (the date under a time basis, the connection count under connections) instead of its usual name/subject — to read the depth value straight off the graph. */
	labelAsZ: z.boolean().default(false),
	/** Positions the user pinned by dragging, id → [x,y]. Persisted so a dragged layout survives a reload (a page-wide layout choice). */
	pins: z.record(z.string(), z.tuple([z.number(), z.number()])).default({}),
	/** Keep the active (selected) node centred and readable through selection changes and re-layouts. */
	follow: z.boolean().default(false),
	/** Prune nodes without a visible edge. */
	prune: z.boolean().default(false),
	/** Hold the accessible reading of the graph open beside the scene. */
	readAsDocument: z.boolean().default(false),
	/** Which settings group's row is open under the head — exclusive; null keeps the head to one row. Transient
	 *  disclosure: not persisted, a reload starts with the head alone. */
	openSettings: z.enum(SETTINGS_GROUP_NAMES).nullable().default(null),
});

/**
 * shu-polymorphic-graph-view — the data-feeding host for the extracted <shu-graph-scene>. It owns the ONE data pathway
 * (fetch, live SSE merge, type filter, cluster/neighborhood expansion, selection, time cursor) inherited from
 * ShuClusteredGraphView, plus the persisted layout choices and the view head (the fixed view tabs + controls shared
 * with the class browser, and the embedded shu-graph-filter). It builds a GraphSceneModel from the base state and pushes it to the scene, forwards the persisted
 * config, relays the scene's neutral outputs to the app's SHU_EVENTs, and re-renders its control bar from the scene's
 * graph-scene-changed. The scene owns the WebGL scene, camera, render loop, focus, drag, enclosures, and axes.
 *
 * Delegation surface: the e2e steppers and unit tests read the scene's live objects off THIS element, so every scene
 * accessor/method the tests use is forwarded 1:1 to this.scene (nodeMap/pipeline/graph/fgCamera, inspect/pickAt/openNode/
 * setHoveredNode/fitGraph/fitGraphAround/zoomBy/panBy/orbitBy/resetProfile).
 *
 * Light DOM (createRenderRoot returns this): the scene resolves its A-Frame camera through document.querySelector, and
 * the child scene chrome is positioned against this host; a shadow root would hide both.
 */
export class ShuPolymorphicGraphView extends ShuClusteredGraphView<typeof PolymorphicStateSchema> {
	/** Layout choices are remembered across reloads (ShuElement.persistFields; singleton key). */
	static persistFields = ["viewType", "flatten", "grouped", "groupBy", "zBasis", "labelAsZ", "pins", "follow", "prune", "readAsDocument"] as const;

	// Control-bar inputs the scene derives from its data/layout (via graph-scene-changed) — the axes that vary with the
	// data. type + role are always offered, so they seed the pre-data render; suppressesGrouping is false in the force view.
	private groupByAxes: string[] = ["type", "role"];
	private forces: TViewForces = {};
	private countsText = "";
	private latestStep: string | null = null;
	private sceneConfig!: GraphSceneConfig;
	/** The saved scenes offered in the settings, fetched by this host (the settings element reaches no RPC of its own). */
	private sceneNames: string[] = [];
	/** What went wrong with the last scene a reader asked to save or return to, shown beside the controls; null when nothing did. */
	private sceneError: string | null = null;

	constructor() {
		super(PolymorphicStateSchema, {});
		this.buildSceneConfig();
	}

	/** Light DOM: A-Frame element scanners can't reach shadow DOM, and the scene chrome positions against this host. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** External-data mode (`data-external` attribute): no RPC/SSE/selection wiring — the caller feeds quads via setQuads. */
	protected override get usesExternalData(): boolean {
		return this.hasAttribute("data-external");
	}

	/** Feed a complete snapshot (mirrors the overview's setQuads contract). Routes through the normal repaint path. */
	setQuads(quads: TQuad[], clusters: TCluster[] = []): void {
		this.setGraphState({ quads, clusters });
		this.onGraphData();
	}

	private get scene(): ShuGraphScene | null {
		return this.querySelector<ShuGraphScene>("shu-graph-scene");
	}

	/** The visible graph as JSON-LD — the scene's one representation, shared with the copy-graph button. */
	summarizeForKihan(): TLinkedData | null {
		return this.scene?.graphJsonLd() ?? null;
	}

	private get filterEl(): ShuGraphFilter | null {
		return this.querySelector("shu-graph-filter");
	}

	/* Delegation surface — the tests read the scene's live objects off THIS element; forward each 1:1 (same object). */
	get nodeMap() {
		return this.scene?.nodeMap;
	}
	get pipeline() {
		return this.scene?.pipeline;
	}
	get graph(): FGInstance | undefined {
		return this.scene?.graph;
	}
	get fgCamera() {
		return this.scene?.fgCamera;
	}
	inspect(): Record<string, unknown> {
		return this.scene?.inspect() ?? {};
	}
	/** The current graph as a self-contained SVG still — the report and still-image medium. */
	still(): string {
		return this.scene?.still() ?? "";
	}
	resetProfile(): void {
		this.scene?.resetProfile();
	}
	pickAt(clientX: number, clientY: number): string | null {
		return this.scene?.pickAt(clientX, clientY) ?? null;
	}
	projectNodeToScreen(id: string): { x: number; y: number } | null {
		return this.scene?.projectNodeToScreen(id) ?? null;
	}
	openNode(id: string): boolean {
		return this.scene?.openNode(id) ?? false;
	}
	setHoveredNode(id: string | null): void {
		this.scene?.setHoveredNode(id);
	}
	/** Fit ends following: the two ask for opposite framings (the whole graph vs the active node's context), and a fit
	 *  under an active follow would be undone at the next settle. Asking for the whole graph is asking to stop following. */
	fitGraph(): void {
		this.endFollow();
		this.scene?.fitGraph();
	}
	fitGraphAround(nodeId: string): void {
		this.scene?.fitGraphAround(nodeId);
	}
	zoomBy(amount: number, unit: "pixels" | "percent", dir: "in" | "out"): void {
		this.scene?.zoomBy(amount, unit, dir);
	}
	panBy(amount: number, unit: "pixels" | "percent", dir: "left" | "right" | "up" | "down"): void {
		this.scene?.panBy(amount, unit, dir);
	}
	orbitBy(degrees: number, dir: "left" | "right" | "up" | "down"): void {
		this.scene?.orbitBy(degrees, dir);
	}
	rotateTo(aim: "xy" | "z"): void {
		this.endFollow();
		this.scene?.rotateTo(aim);
	}

	/** Asking for a framing IS asking the camera to stop chasing: every deliberate re-frame a reader can take ends
	 *  following, so the rule is stated once rather than at whichever button happened to be built first. */
	private endFollow(): void {
		if (this.state.follow) this.setOption({ follow: false });
	}

	/** Scrub the shared time cursor (the same global signal the timeline drives): nodes recorded after `ms` are hidden;
	 * null means live/now (all shown). A real "show the graph as of T" capability, and the interface the time-cursor test drives. */
	setTimeCursor(ms: number | null): void {
		this.timeCursor = ms;
	}

	/** Reveal or hide the included ontology SCHEMA (Class + Property) via the filter, exactly as ticking their chips does —
	 *  the schema is default-hidden and revealed ALONGSIDE the instance data. A real capability + the interface a control step drives. */
	revealSchema(visible: boolean): void {
		this.filterEl?.setTypeVisibility([ONTOLOGY_CLASS, ONTOLOGY_PROPERTY], visible);
	}

	/**
	 * This view as a scene records it: the layout options and the filter's own, each read through the element that owns
	 * them, plus the time the reader is looking at. The cursor is not a persisted option (it is the shared time signal),
	 * so it is read from the signal and restored through the same interface a scrub uses.
	 */
	captureScene(): TSceneState {
		const state = captureScene([this, ...(this.filterEl ? [this.filterEl] : [])]);
		state[TIME_CURSOR_KEY] = { timeCursor: this.timeCursor };
		return state;
	}

	/** Return this view to a saved scene: every option through its own element's ordinary setState, then the time cursor. */
	applyScene(state: TSceneState): void {
		const { [TIME_CURSOR_KEY]: cursor, ...views } = state;
		applyScene([this, ...(this.filterEl ? [this.filterEl] : [])], views);
		this.scene?.setUserPins(this.state.pins);
		this.scene?.setConfig(this.buildSceneConfig());
		if (cursor) this.setTimeCursor(typeof cursor.timeCursor === "number" ? cursor.timeCursor : null);
		this.pushSceneModel();
		// A scene remembers what the graph shows, not where the camera stood: what it shows is about to be laid out afresh,
		// so the view frames it. The fit is deferred until that layout has come to rest.
		this.scene?.fitGraph();
	}

	/** The settings report the reader's intent; the host does the saving and the returning, as it does for every option. */
	private onSaveScene = (name: string): void => void this.saveSceneAs(name);
	private onApplyScene = (name: string): void => void this.applySavedScene(name);

	/** Save this view under a name, through the same step RPC every write goes through, then re-offer the saved scenes.
	 *  A write that does not land is SAID so, beside the control that asked for it: a save that quietly did nothing looks
	 *  exactly like a save that worked until the reader comes back for the scene. */
	private async saveSceneAs(name: string): Promise<void> {
		const written = await saveScene(name, this.captureScene(), "polymorphic: save this view as a scene");
		this.sceneError = written.ok === false ? `could not save "${name}": ${written.error}` : null;
		if (written.ok !== false) await this.loadScenes();
		this.requestUpdate();
	}

	/** Return this view to the scene saved under a name. The view then says which scene it is showing, so a reader (or a
	 *  step) can tell the return has landed rather than guess at a moment. */
	private async applySavedScene(name: string): Promise<void> {
		if (!name) return;
		const scene = await readScene(name, "polymorphic: return to a saved scene");
		if (!scene) {
			this.sceneError = `no scene is saved as "${name}"`;
			this.requestUpdate();
			return;
		}
		this.sceneError = null;
		this.applyScene(scene.state);
		this.setAttribute("data-scene", name);
	}

	/** The saved scenes a reader can return to. Fetched by the host and handed down to the settings; a control never reaches the RPC. */
	private async loadScenes(): Promise<void> {
		if (this.usesExternalData) return; // fed by its caller: this view has no RPC of its own
		this.sceneNames = (await listScenes("polymorphic: offer the saved scenes")).map((scene) => scene.id);
		this.requestUpdate();
	}

	override render(): TemplateResult {
		const open = this.state.openSettings;
		return html`
			${unsafeHTML(`<style>${FISHEYE_CSS}</style>`)}
			<div class="view-root">
			<div class="view-head">
				<div class="view-controls">
					${viewActions({
						fitId: POLYMORPHIC_IDS.FIT,
						copyId: POLYMORPHIC_IDS.COPY_GRAPH,
						onFit: () => this.fitGraph(),
						getCopyText: () => this.scene?.graphCopyText() ?? "",
						toggles: [
							{
								id: POLYMORPHIC_IDS.FOLLOW,
								glyph: "◎",
								label: "follow",
								title: "keep the active node centred and readable",
								on: this.state.follow,
								onToggle: (on) => this.setOption({ follow: on }),
							},
							{
								id: POLYMORPHIC_IDS.PRUNE,
								glyph: "⊘",
								label: "prune",
								title: "prune nodes without an edge",
								on: this.state.prune,
								onToggle: (on) => this.setOption({ prune: on }),
							},
							{
								id: POLYMORPHIC_IDS.READ,
								glyph: "🧭",
								title: "guide: every node and what it links to, as a list to read and navigate by",
								on: this.state.readAsDocument,
								onToggle: (on) => this.setOption({ readAsDocument: on }),
							},
						],
						settings: { openGroup: open, idFor: (group) => POLYMORPHIC_IDS.SETTINGS[group], onGroup: (group) => this.openGroup(group) },
					})}
					<span id="polymorphic-counts">${this.countsText}</span>
					<span id="polymorphic-step" data-testid=${POLYMORPHIC_IDS.LATEST_STEP} ?hidden=${!this.latestStep}>${this.latestStep ?? ""}</span>
				</div>
			</div>
			${this.renderSettingsRow(open)}
			<shu-graph-filter></shu-graph-filter>
			<div class="graph-area"><shu-graph-scene></shu-graph-scene></div>
			</div>
		`;
	}

	/** The open group's controls, on their own row under the head. Rendered only while open: what a reader can reach
	 *  and what a step can drive are the same thing. The filters group shows the filter element instead (see updated —
	 *  the filter stays mounted so its live chip feed and persistence run whether or not it is on screen). */
	private renderSettingsRow(open: TSettingsGroup | null): TemplateResult {
		if (!open || open === "filters") return html``;
		// The layout group opens with the two head-on aims, which are actions rather than options, so the host renders
		// them; the options beside them are the settings element's own.
		return html`<div class="settings-row">
			${open === "layout" ? rotateControls({ xyId: POLYMORPHIC_IDS.ROTATE_XY, zId: POLYMORPHIC_IDS.ROTATE_Z, onRotate: (aim) => this.rotateTo(aim) }) : ""}
			<shu-polymorphic-settings
				.group=${open}
				.options=${this.sceneConfig}
				.groupByAxes=${this.groupByAxes}
				.forces=${this.forces}
				.scenes=${this.sceneNames}
				.sceneError=${this.sceneError}
				.onChange=${this.onSettingsChange}
				.onSaveScene=${this.onSaveScene}
				.onApplyScene=${this.onApplyScene}
			></shu-polymorphic-settings>
		</div>`;
	}

	/** Open a settings group's row (closing any other — the groups are exclusive), or close the open one. */
	private openGroup(group: TSettingsGroup | null): void {
		this.setState({ openSettings: group });
		// The scenes on offer are read when a reader OPENS the group, which is when they look at them. Reading them once
		// at load offered whatever existed then, so a scene saved since (by a step, another column, another session) was
		// missing until the page was reloaded.
		if (group === "scenes") void this.loadScenes();
	}

	/** The ∇ group shows the filter: the element stays mounted (its live chip feed and persistence run regardless) and
	 *  gates its own visibility on `show-controls`, so opening the group is setting that one attribute. */
	protected updated(): void {
		const f = this.filterEl;
		if (!f) return;
		if (this.state.openSettings === "filters") f.setAttribute("show-controls", "");
		else f.removeAttribute("show-controls");
	}

	protected override async onGraphConnected(): Promise<void> {
		await this.updateComplete; // renders the control bar and creates the <shu-graph-scene> child
		// Devtools handle for the layout query: `shuPolymorphic.inspect()` — the method name alone collides with the console's
		// built-in inspect(). Last connected view wins; cleared on disconnect if still this instance.
		(globalThis as { shuPolymorphic?: ShuPolymorphicGraphView }).shuPolymorphic = this;
		this.autoTeardown(() => {
			const g = globalThis as { shuPolymorphic?: ShuPolymorphicGraphView };
			if (g.shuPolymorphic === this) g.shuPolymorphic = undefined;
		});
		// The host is the view's test root; features wait on this id (declared in test-ids.ts) before driving the scene.
		this.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.ROOT);

		// Relay the scene's neutral outputs to the app's events, unchanged from when this element dispatched them directly.
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_CLICK, ((e: CustomEvent<{ label: string; subject: string; addToSelection: boolean }>) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_OPEN_PANE, ((e: CustomEvent) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.CLUSTER_EXPAND, ((e: CustomEvent<{ type: string }>) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_CLUSTER_EXPAND, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.RESCHEDULE_REQUEST, ((e: CustomEvent<{ updates: RescheduleUpdate[] }>) => {
			void this.applyReschedule(e.detail.updates);
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.SCENE_CHANGED, ((e: CustomEvent<GraphSceneChangedDetail>) => this.onSceneChanged(e.detail)) as EventListener);
		// A view that needs its actors asks for them: shown through the filter, so the chips report what the graph shows
		// and the reader can put them away again.
		this.autoListen(this, GRAPH_SCENE_EVENT.SCOPE_REVEALED, ((e: CustomEvent<{ types: string[] }>) => this.filterEl?.setTypeVisibility(e.detail.types, true)) as EventListener);
		// Hovering a type in the embedded filter dims every other type so the hovered one stands out.
		this.autoListen(this, SHU_EVENT.GRAPH_TYPE_PREVIEW, ((e: CustomEvent<{ type: string | null }>) => {
			this.scene?.setPreviewType(e.detail?.type ?? null);
		}) as EventListener);

		// Seed the persisted drag-pins BEFORE setConfig: setConfig emits a scene-changed carrying the scene's current
		// pins, so if userPins were still empty that empty set would round-trip through onSceneChanged and clobber the
		// just-restored state.pins (and persist the clobber). Seeding first makes that emit carry the restored pins.
		this.scene?.setUserPins(this.state.pins);
		// Seed the persisted layout choices; the base's first refetch (below onGraphConnected) then pushes the initial model.
		this.scene?.setConfig(this.buildSceneConfig());
		void this.loadScenes();
	}

	/** Re-render the control bar from the scene's derived inputs (the group-by axes, whether grouping is suppressed, and the
	 *  counts / latest step). Called at each scene repaint end and on a config change. */
	private onSceneChanged(d: GraphSceneChangedDetail): void {
		// The scene rebuilds this array on every emit; keep the identity when the axes are the same, or the settings element
		// dirty-checks a new array each repaint and re-renders its controls for nothing.
		if (d.groupByAxes.join("\0") !== this.groupByAxes.join("\0")) this.groupByAxes = d.groupByAxes;
		this.forces = d.forces;
		const c = d.counts;
		const edgePart = `${c.edges} edges (${c.relTypes} ${c.relTypes === 1 ? "type" : "types"})`;
		this.countsText = `${c.nodes} nodes · ${edgePart}${c.omitted ? ` · ${c.omitted} omitted` : ""}`;
		this.latestStep = d.latestStep;
		// Persist the user's drag-pins (a page-wide layout choice) whenever they change — a dragged layout then survives a reload.
		if (JSON.stringify(d.pins) !== JSON.stringify(this.state.pins)) this.setState({ pins: d.pins });
		this.requestUpdate();
	}

	/** Assemble the scene's data slice from the base state (the time-filtered visibleQuads is the base's one time pathway). */
	private buildSceneModel(): GraphSceneModel {
		return {
			quads: this.cgState.quads,
			visibleQuads: this.visibleQuads,
			clusters: this.cgState.clusters,
			knownClusters: this.knownClusters,
			hiddenGraphs: this.cgState.hiddenGraphs,
			hiddenPredicates: this.cgState.hiddenPredicates,
			site: this.cgState.site,
			perTypeLimit: this.cgState.perTypeLimit,
			timeCursor: this.timeCursor,
		};
	}

	/**
	 * The layout choices as the scene takes them, rebuilt ONLY when one of them changes. The settings element holds this
	 * same object and dirty-checks it by identity, so a fresh literal per render would re-render every control on every
	 * scene repaint — ten times a second under a time-cursor scrub, re-committing selects the reader may have open.
	 */
	private buildSceneConfig(): GraphSceneConfig {
		const s = this.state;
		this.sceneConfig = {
			viewType: s.viewType,
			flatten: s.flatten,
			grouped: s.grouped,
			groupBy: s.groupBy,
			zBasis: s.zBasis,
			labelAsZ: s.labelAsZ,
			follow: s.follow,
			prune: s.prune,
			readAsDocument: s.readAsDocument,
		};
		return this.sceneConfig;
	}

	/** Feed the scene the current data slice and refresh the filter's chip source (the filter is host-owned). */
	private pushSceneModel(): void {
		this.filterEl?.setSource(this.knownClusters, this.cgState.quads);
		this.scene?.setModel(this.buildSceneModel());
	}

	protected override onGraphData(): void {
		this.pushSceneModel();
		this.offerNewScenes();
	}

	/**
	 * A scene saved anywhere (this view, another column, a step, another session) arrives here as live data, so the
	 * offer is refreshed the moment one appears rather than only when the settings are next opened. The names come from
	 * the live quads; the scene itself is still read through the step RPC, since an observation truncates long values.
	 */
	private offerNewScenes(): void {
		const live = this.cgState.quads.filter((q) => q.namedGraph === SCENE_LABEL).map((q) => q.subject);
		if (live.some((name) => !this.sceneNames.includes(name))) void this.loadScenes();
	}

	protected override onGraphSelection(subject: string | null): void {
		this.scene?.setSelectedSubject(subject);
	}

	/** A cursor move re-styles cheaply (depth re-place; positions pinned): paint promptly through the scene's cursor path,
	 *  not the streamed-data window. The fresh time-filtered slice goes down first, then the prompt re-style fires. */
	protected override get timeSyncCoalesceMs(): number {
		return CURSOR_COALESCE_MS;
	}
	protected override onTimeCursorPaint(): void {
		this.pushSceneModel();
		this.scene?.setTimeCursorValue(this.timeCursor);
	}

	/** Persist each gantt-bar reschedule the scene emitted, refetch, then have the scene repaint at once. */
	private async applyReschedule(updates: RescheduleUpdate[]): Promise<void> {
		// Fail-fast: a reschedule that didn't persist must not pass silently as a moved-but-unsaved bar — surface it.
		for (const u of updates) {
			await conduit().follow(
				{ method: "GraphStepper-updateVertex", params: { label: u.label, id: u.id, data: u.data } },
				"polymorphic: drag gantt bar → reschedule task and its dependents",
			);
		}
		await this.refetchSnapshot({ perTypeLimit: this.cgState.perTypeLimit });
		this.scene?.flushRepaint();
	}

	/** ONE path for every layout/view option — the settings element's changes and the head toggles alike: the host holds
	 *  the (persisted) state and pushes the whole config to the scene. */
	private setOption(change: Partial<z.infer<typeof PolymorphicStateSchema>>): void {
		this.setState(change);
		this.scene?.setConfig(this.buildSceneConfig());
	}

	/** The settings element reports which option the reader touched. */
	private onSettingsChange = (change: TPolymorphicOptionChange): void => {
		this.setOption(change as Partial<z.infer<typeof PolymorphicStateSchema>>);
	};
}

if (!customElements.get("shu-polymorphic-graph-view")) {
	customElements.define("shu-polymorphic-graph-view", ShuPolymorphicGraphView);
}
