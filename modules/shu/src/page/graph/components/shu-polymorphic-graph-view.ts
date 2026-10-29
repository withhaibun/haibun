import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphInitialState, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import { statedTotal, type TLinkedData } from "@haibun/core/lib/domains/hypermedia.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../../domains/elements.js";
import { defineElement } from "../../controllers/element-controller.js";
import { acts } from "../../domains/links.js";
import { conduit } from "../../controllers/conduit-controller.js";
import type { TPresenterNodeClick } from "../../ports.js";
import { applyScene, captureScene, listScenes, readScene, saveScene } from "../controllers/scenes-controller.js";
import { sceneType, type TSceneState } from "../derivations/scenes.js";

/** The time a reader is looking at, held in a scene beside the views' own options. It is not an element's option but the shared time signal, so it is recorded under its own key. */
const TIME_CURSOR_KEY = "time-cursor";

/** What the status line states of what the graph shows: its nodes, its edges and their types, what it omits, and the nodes
 *  that prune removes where prune is set. */
function countsText(c: GraphSceneChangedDetail["counts"], prune: boolean): string {
	const omitted = c.omitted.total > 0 ? [`${statedTotal(c.omitted)} omitted`] : [];
	const pruned = prune ? [`${c.pruned} pruned`] : [];
	return [`${c.nodes} nodes`, `${c.edges} edges (${c.relTypes} ${c.relTypes === 1 ? "type" : "types"})`, ...omitted, ...pruned].join(" · ");
}

const POLYMORPHIC_IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { VIEW, VIEW_TYPES } from "../domains/views.js";
import type { TPolymorphicOptionChange } from "./shu-polymorphic-settings.js";
import { ViewAxiomsProductsSchema, type TGraphView, type TViewAxioms } from "../../../domains/graph-view.js";
import { LoadController } from "../../controllers/load-controller.js";
import { callStep } from "../../controllers/read-controller.js";
import { appAccessLevel } from "../../controllers/view-query-controller.js";
import { ClockController } from "../../controllers/clock-controller.js";
import { SOURCE_FORMATS } from "../domains/sources.js";
import type { TDrawn } from "../derivations/source-lines.js";
import { axiomOverlay, sameOverlay, type TAxiomOverlay, type TCarried } from "../derivations/axiom-overlay.js";
import { linkEndId } from "../domains/graph-types.js";
import "./shu-graph-source.js";
import type { TGraphSourcePane } from "./shu-graph-source.js";
import "../../components/shu-refusal.js";
import type { TViewForces } from "./render-type.js";
import "./shu-polymorphic-settings.js";
import { viewHeadCss, viewActions, rotateControls, SETTINGS_GROUP_NAMES } from "./view-head.js";
import type { TSettingsGroup } from "../../../domains/elements.js";

import { type GraphSceneConfig, type GraphSceneModel, type GraphSceneChangedDetail, type RescheduleUpdate, type ShuGraphScene } from "./scene.js";
import { GRAPH_SCENE_EVENT } from "../domains/graph-types.js";
import { PaneOpenSchema, addsToSelection, type TPaneOpen } from "../../derivations/pane-kinds.js";
import { persistScopeOf } from "./shu-graph-filter.js";
import "./scene.js";

// A cursor move re-styles (depth re-place, positions pinned), fast, so it paints promptly. NOT the streamed-data
// window (which would stack to ~1s); the base coalesces continuous scrubbing to this before it reaches onTimeCursorPaint.
const CURSOR_COALESCE_MS = 100;
/** A change of what the graph shows reads its axioms again once per this window, so a stream of batches or a scrub reads them
 *  once rather than once a batch. A reader's own choice reads them at once. */
const AXIOMS_COALESCE_MS = 500;
/** The name the coalesced read of the axioms is held under. */
const AXIOMS_READ = "axioms-read";
/** The format the DL view and the axioms pane read the graph's axioms in first. */
const [AXIOMS_FORMAT] = SOURCE_FORMATS;

// Composed statically and rendered via unsafeHTML: lit leaves bindings inside a <style> element uninterpolated,
// so the shared view-head rules cannot be interpolated in the template itself. The view is positioned, so the scene's canvas
// (absolute, inset 0) is bounded by it, since otherwise the nearest positioned ancestor is the column and the canvas covers the
// controls of the pane that holds the graph. What the graph states of itself, its counts and its latest step, is on a line of
// the head of its own under the icons, one line high whatever it states, so a change of it doesn't move a control under a
// press. The latest step is hidden where a SeqPath isn't visible.
const FISHEYE_CSS = `
	shu-polymorphic-graph-view { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--shu-bg); }
	shu-polymorphic-graph-view shu-graph-filter { flex: 0 0 auto; }
	${viewHeadCss("shu-polymorphic-graph-view")}
	shu-polymorphic-graph-view .view-status { width: 100%; min-width: 0; display: flex; align-items: center; gap: var(--shu-space-2); min-height: calc(1lh + 2 * var(--shu-space-1)); white-space: nowrap; }
	shu-polymorphic-graph-view .view-status > * { overflow: hidden; text-overflow: ellipsis; }
	shu-polymorphic-graph-view #polymorphic-counts { color: var(--shu-fg-muted); }
	shu-polymorphic-graph-view #polymorphic-step { max-width: 30ch; background: var(--shu-fg); color: var(--shu-bg); padding: var(--shu-space-1) var(--shu-space-3); border-radius: var(--shu-radius); font-weight: 600; }
`;

const PolymorphicStateSchema = z.object({
	...clusteredGraphStateShape,
	viewType: z.enum(VIEW_TYPES),
	flatten: z.boolean(),
	grouped: z.boolean(),
	groupBy: z.string(), // axis: "type" (@type), "role" (highest-priority actor), or an actor predicate (a rel)
	/** What places depth (z): the object's valid time (the catalog's validTimeField), its indexed time (generatedAtTime), or its number of connections. */
	zBasis: z.enum(["valid", "indexed", "connections"]),
	/** Label chips with each node's z factor (the date under a time basis, the connection count under connections) instead of its usual name/subject, to read the depth value straight off the graph. */
	labelAsZ: z.boolean(),
	/** Positions the user pinned by dragging, id → [x,y]. Persisted so a dragged layout survives a reload (a page-wide layout choice). */
	pins: z.record(z.string(), z.tuple([z.number(), z.number()])),
	/** Keep the active (selected) node centred and readable through selection changes and re-layouts. */
	follow: z.boolean(),
	/** Prune nodes without a visible edge. */
	prune: z.boolean(),
	/** Hold the accessible reading of the graph open beside the scene. */
	readAsDocument: z.boolean(),
	/** The DL view: the graph's nodes and edges with the axioms that the ontology states of them. */
	dl: z.boolean(),
	/** Which settings group's row is open under the head, exclusive; null keeps the head to one row. Transient
	 *  disclosure: not persisted, a reload starts with the head alone. */
	openSettings: z.enum(SETTINGS_GROUP_NAMES).nullable(),
});

/** The graph view before a reader chooses an option: the force view, ungrouped and unflattened, depth by valid time, without pins, with the head alone (CA4D7). */
const POLYMORPHIC_INITIAL_STATE: z.input<typeof PolymorphicStateSchema> = {
	...clusteredGraphInitialState,
	viewType: VIEW.force,
	flatten: false,
	grouped: false,
	groupBy: "type",
	zBasis: "valid",
	labelAsZ: false,
	pins: {},
	follow: false,
	prune: false,
	readAsDocument: false,
	dl: false,
	openSettings: null,
};

/**
 * shu-polymorphic-graph-view: the data-feeding host for the extracted <shu-graph-scene>. It owns the ONE data pathway
 * (fetch, live SSE merge, type filter, cluster/neighborhood expansion, selection, time cursor) inherited from
 * ShuClusteredGraphView, plus the persisted layout choices and the view head (the fixed view tabs + controls shared
 * with the class browser, and the embedded shu-graph-filter). It builds a GraphSceneModel from the base state and pushes it to the scene, forwards the persisted
 * config, relays the scene's neutral outputs to the app's SHU_EVENTs, and re-renders its control bar from the scene's
 * graph-scene-changed. The scene owns the WebGL scene, camera, render loop, focus, drag, enclosures, and axes.
 *
 * Light DOM (createRenderRoot returns this): the scene resolves its A-Frame camera through document.querySelector, and
 * the child scene chrome is positioned against this host; a shadow root would hide both.
 */
export class ShuPolymorphicGraphView extends ShuClusteredGraphView<typeof PolymorphicStateSchema> {
	/** Layout choices persist across reloads (ShuElement.persistFields; singleton key). */
	static persistFields = ["viewType", "flatten", "grouped", "groupBy", "zBasis", "labelAsZ", "pins", "follow", "prune", "readAsDocument", "dl"] as const;

	// Control-bar inputs the scene derives from its data/layout (via graph-scene-changed): the axes that vary with the
	// data. type + role are always offered, so they seed the pre-data render; suppressesGrouping is false in the force view.
	private groupByAxes: string[] = ["type", "role"];
	private forces: TViewForces = {};
	/** What the graph shows, as the scene last counted it, which the status line states. */
	private counts: GraphSceneChangedDetail["counts"] | null = null;
	private latestStep: string | null = null;
	private sceneConfig!: GraphSceneConfig;
	/** The page's clock, which holds the coalesced read of the axioms and cancels it as the view leaves the page. */
	readonly #clock = new ClockController(this);
	/** The axioms of what the graph shows, which the DL view maps onto the scene and the ¶ control opens in a pane. */
	readonly #axioms = new LoadController<TViewAxioms>(this, async () => {
		const outcome = await callStep<unknown>(AXIOMS_FORMAT.step, { view: this.shownView() }, `the graph as ${AXIOMS_FORMAT.label}`);
		return outcome.ok ? { ok: true, value: ViewAxiomsProductsSchema.parse(outcome.value) } : outcome;
	});
	/** The axioms the DL view maps onto the nodes and edges the scene draws; null outside the DL view. */
	#overlay: TAxiomOverlay | null = null;
	/** The saved scenes offered in the settings, fetched by this host (the settings element doesn't call an RPC of its own). */
	private sceneNames: string[] = [];
	/** What went wrong with the last scene a reader asked to save or return to, shown beside the controls; null when the last one succeeded. */
	private sceneError: string | null = null;

	constructor() {
		super(PolymorphicStateSchema, POLYMORPHIC_INITIAL_STATE);
		this.buildSceneConfig();
	}

	/** External-data mode (`data-external` attribute): the embedding host gives the quads (setQuads) and the selection
	 *  (selectNode); the view doesn't read from the store. */
	protected override get usesExternalData(): boolean {
		return this.hasAttribute("data-external");
	}

	/** The scope that holds its settings and filter choices: its host's (`data-persist-scope`), apart from the main
	 *  graph's, or the main graph's own. */
	protected override get persistKey(): string {
		return persistScopeOf(this);
	}
	protected override get filterPersistScope(): string {
		return this.persistKey;
	}

	/** Draw a host's complete graph. A host without cluster records for its types gives its quads alone, and each type
	 *  is then drawn from its quads. */
	setQuads(quads: TQuad[], clusters?: TCluster[]): void {
		this.setExternalData(quads, clusters === undefined ? [] : clusters);
	}

	/** The node the host marks as active, held so a scene mounted later marks it too. */
	private hostSelection: string | null = null;
	/** The nodes the host lights, held so a scene mounted later lights them too. */
	private hostPreview: string[] | null = null;

	/** Mark the node its host is on as the active node: an external host's selection, as the page's is the main graph's. */
	selectNode(id: string | null): void {
		this.hostSelection = id;
		this.scene?.setSelectedSubject(id);
	}

	/** Light these nodes and dim the rest, as a type chip under the pointer lights its type. */
	previewNodes(ids: string[] | null): void {
		this.hostPreview = ids;
		this.scene?.setPreview(ids === null ? null : { subjects: new Set(ids) });
	}

	/** What a reader is looking at, as the scene states it. The copy-graph button keeps the whole graph in draw order,
	 *  which is what a person saves to a file. */
	summarizeForContext(): TLinkedData | null {
		return this.scene?.summarizeForContext() ?? null;
	}

	/** Fit ends following: the two state opposite framings (the whole graph vs the active node's context), and a fit
	 *  under an active follow would be undone at the next settle. A request for the whole graph is a request to stop following. */
	private fitGraph(): void {
		this.endFollow();
		this.scene?.fitGraph();
	}

	/** A head-on aim ends following too: `xy` faces the layout plane, `z` faces the depth axis. */
	private rotateTo(aim: "xy" | "z"): void {
		this.endFollow();
		this.scene?.rotateTo(aim);
	}

	/** A request for a framing IS a request for the camera to stop chasing: every deliberate re-frame a reader can take
	 *  ends following, so the rule is stated once rather than at whichever button happened to be built first. */
	private endFollow(): void {
		if (this.state.follow) this.setOption({ follow: false });
	}

	/** Scrub the shared time cursor (the same global signal the timeline drives): nodes recorded after `ms` are hidden;
	 * null means live/now (all shown). */
	private setTimeCursor(ms: number | null): void {
		this.timeline.movePage(ms);
	}

	/**
	 * This view as a scene records it: the layout options and the filter's own, each read through the element that owns
	 * them, plus the time the reader is viewing. The cursor is not a persisted option (it is the shared time signal),
	 * so it is read from the signal and restored through the same interface a scrub uses.
	 */
	captureScene(): TSceneState {
		const state = captureScene([this, ...(this.filterEl ? [this.filterEl] : [])]);
		state[TIME_CURSOR_KEY] = { timeCursor: this.timeline.cursor };
		return state;
	}

	/** Return this view to a saved scene: every option through its own element's ordinary setState, then the time cursor. */
	applyScene(state: TSceneState): void {
		const { [TIME_CURSOR_KEY]: cursor, ...views } = state;
		applyScene([this, ...(this.filterEl ? [this.filterEl] : [])], views);
		this.scene?.setUserPins(this.state.pins);
		this.configureScene();
		if (cursor) this.setTimeCursor(typeof cursor.timeCursor === "number" ? cursor.timeCursor : null);
		this.readAxioms();
		this.pushSceneModel();
		// A scene records what the graph shows, not where the camera stood: what it shows is about to be laid out afresh,
		// so the view frames it. The fit is deferred until that layout has come to rest.
		this.scene?.fitGraph();
	}

	/** The settings report the reader's intent; the host does the saving and the returning, as it does for every option. */
	private onSaveScene = (name: string): void => void this.saveSceneAs(name);
	private onApplyScene = (name: string): void => void this.applySavedScene(name);

	/** Save this view under a name, through the same step RPC that carries every write, then re-offer the saved scenes.
	 *  A write that does not land is shown beside the control that requested it: a save that quietly didn't write looks
	 *  exactly like a save that worked until the reader comes back for the scene. */
	private async saveSceneAs(name: string): Promise<void> {
		const written = await saveScene(name, this.captureScene(), "polymorphic: save this view as a scene");
		this.sceneError = written.ok === false ? `could not save "${name}": ${written.refusal.error}` : null;
		if (written.ok !== false) await this.loadScenes();
		this.requestUpdate();
	}

	/** Return this view to the scene saved under a name. The view states which scene it shows once the return has landed, and
	 *  doesn't state one while the return is under way, so a reader (or a step) reads that the return landed. */
	private async applySavedScene(name: string): Promise<void> {
		if (!name) return;
		this.removeAttribute(SHU_ATTR.SCENE);
		const scene = await readScene(name, "polymorphic: return to a saved scene");
		if (!scene) {
			this.sceneError = `a scene isn't saved as "${name}"`;
			this.requestUpdate();
			return;
		}
		this.sceneError = null;
		this.applyScene(scene.state);
		this.setAttribute(SHU_ATTR.SCENE, name);
	}

	/** The saved scenes a reader can return to, fetched by the host and handed down to the settings; a control never reaches the RPC. */
	private async loadScenes(): Promise<void> {
		if (this.usesExternalData) return; // fed by its caller: this view doesn't have an RPC of its own
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
						getCopyText: () => this.mountedScene.graphCopyText(),
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
							// A host's own graph doesn't have axioms the store states: only the main graph reads them.
							...(this.usesExternalData
								? []
								: [
										{
											id: POLYMORPHIC_IDS.DL,
											glyph: "⊑",
											title: "DL: each node and edge with the axioms the ontology states of it, entailed types marked ⊨",
											on: this.state.dl,
											onToggle: (on: boolean) => this.setOption({ dl: on }),
										},
									]),
						],
						settings: { openGroup: open, idFor: (group) => POLYMORPHIC_IDS.SETTINGS[group], onGroup: (group) => this.openGroup(group) },
					})}
				</div>
				${this.usesExternalData ? "" : html`<button type="button" data-testid=${POLYMORPHIC_IDS.AXIOMS} title="axioms: the graph as text, in a pane of its own" @click=${(e: MouseEvent) => void this.openAxioms(undefined, addsToSelection(e))}>¶</button>`}
				<div class="view-status">
					${this.#axioms.render<TemplateResult | string>({ pending: () => "", running: () => "", completed: () => "", failed: (refusal) => html`<shu-refusal .refusal=${refusal} .readAgain=${() => this.readAxioms()}></shu-refusal>` })}
					<span id="polymorphic-counts">${this.counts === null ? "" : countsText(this.counts, this.state.prune)}</span>
					<span id="polymorphic-step" data-testid=${POLYMORPHIC_IDS.LATEST_STEP} ?hidden=${!this.latestStep}>${this.latestStep}</span>
				</div>
			</div>
			${this.renderSettingsRow(open)}
			<shu-graph-filter data-persist-scope=${this.persistKey}></shu-graph-filter>
			<div class="graph-area"><shu-graph-scene></shu-graph-scene></div>
			</div>
		`;
	}

	/** The open group's controls, on their own row under the head. Rendered only while open: what a reader can reach
	 *  and what a step can drive are the same thing. The filters group shows the filter element instead (see updated:
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
				.choices=${VIEW_TYPES}
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

	/** Open a settings group's row (closing any other: the groups are exclusive), or close the open one. */
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

	/** The view's own root: every feature that drives the graph waits for it. */
	protected override get rootTestId(): string {
		return SHU_TEST_IDS.POLYMORPHIC_VIEW.ROOT;
	}

	protected override async onGraphConnected(): Promise<void> {
		await super.onGraphConnected();
		// The scene outputs this view relays beyond the ones every host does.
		this.autoListen(this, GRAPH_SCENE_EVENT.CLUSTER_EXPAND, ((e: CustomEvent<{ type: string }>) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_CLUSTER_EXPAND, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.RESCHEDULE_REQUEST, ((e: CustomEvent<{ updates: RescheduleUpdate[] }>) => {
			void this.applyReschedule(e.detail.updates);
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.SCENE_CHANGED, ((e: CustomEvent<GraphSceneChangedDetail>) => this.onSceneChanged(e.detail)) as EventListener);
		// A view that needs its actors reveals them through the filter, so the chips report what the graph shows and the
		// reader can put them away again.
		this.autoListen(this, GRAPH_SCENE_EVENT.SCOPE_REVEALED, ((e: CustomEvent<{ types: string[] }>) => this.filterEl?.setTypeVisibility(e.detail.types, true)) as EventListener);
		// Seed the persisted drag-pins BEFORE setConfig: setConfig emits a scene-changed carrying the scene's current
		// pins, so if userPins were still empty that empty set would round-trip through onSceneChanged and clobber the
		// just-restored state.pins (and persist the clobber). Seeding first makes that emit carry the restored pins.
		this.scene?.setUserPins(this.state.pins);
		// Seed the persisted layout choices; the base's first refetch (below onGraphConnected) then pushes the initial model.
		this.configureScene();
		// In the DL view a node or an edge a reader chooses opens the frame that states its axioms in the axioms pane.
		this.autoListen(this, GRAPH_SCENE_EVENT.EDGE_CHOSEN, ((e: CustomEvent<{ key: string }>) => this.openFrameOf(this.#overlay?.edges.get(e.detail.key), false)) as EventListener);
		if (!this.usesExternalData)
			this.autoListen(this, SHU_EVENT.PANE_OPEN, ((e: CustomEvent<TPaneOpen>) => {
				const { pane } = e.detail;
				const node = pane.paneType === "entity" ? pane.id : pane.paneType === "type" ? pane.persistedAs : undefined;
				const carried = node === undefined ? undefined : this.#overlay?.nodes.get(node);
				if (carried === undefined) return;
				e.stopPropagation();
				this.openFrameOf(carried, e.detail.addToSelection);
			}) as EventListener);
		if (this.usesExternalData) {
			this.scene?.setSelectedSubject(this.hostSelection);
			this.previewNodes(this.hostPreview);
			// A node a reader opens is its host's to open: the host holds what its nodes name, where the main graph's are
			// records. Reported as the node's id, in place of the record the scene would open.
			this.autoListen(this, SHU_EVENT.PANE_OPEN, ((e: CustomEvent<TPaneOpen>) => {
				const { pane } = e.detail;
				if (pane.paneType !== "entity") return;
				e.stopPropagation();
				const detail: TPresenterNodeClick = { nodeId: pane.id };
				this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail, bubbles: true, composed: true }));
			}) as EventListener);
		}
		void this.loadScenes();
	}

	/** Re-render the control bar from the scene's derived inputs (the group-by axes, whether grouping is suppressed, and the
	 *  counts / latest step). Called at each scene repaint end and on a config change. */
	private onSceneChanged(d: GraphSceneChangedDetail): void {
		// The scene rebuilds this array on every emit; keep the identity when the axes are the same, or the settings element
		// dirty-checks a new array each repaint and re-renders its controls without a change.
		if (d.groupByAxes.join("\0") !== this.groupByAxes.join("\0")) this.groupByAxes = d.groupByAxes;
		this.forces = d.forces;
		this.counts = d.counts;
		this.latestStep = d.latestStep;
		// Persist the user's drag-pins (a page-wide layout choice) whenever they change: a dragged layout then survives a reload.
		if (JSON.stringify(d.pins) !== JSON.stringify(this.state.pins)) this.setState({ pins: d.pins });
		// What the scene draws changed: the DL view maps the axioms it holds onto it.
		this.mapAxioms();
		this.requestUpdate();
	}

	/** Assemble the scene's data slice from the base state (the time-filtered visibleQuads is the base's one time pathway). */
	protected override buildSceneModel(): GraphSceneModel {
		return {
			quads: this.cgState.quads,
			visibleQuads: this.visibleQuads,
			clusters: this.cgState.clusters,
			knownClusters: this.knownClusters,
			hiddenGraphs: this.cgState.hiddenGraphs,
			hiddenPredicates: this.cgState.hiddenPredicates,
			site: this.cgState.site,
			perTypeLimit: this.cgState.perTypeLimit,
			timeCursor: this.timeline.cursor,
		};
	}

	/**
	 * The layout choices as the scene takes them, rebuilt ONLY when one of them changes. The settings element holds this
	 * same object and dirty-checks it by identity, so a fresh literal per render would re-render every control on every
	 * scene repaint, ten times a second under a time-cursor scrub, re-committing selects the reader may have open.
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

	/** Passes the layout choices to the scene. */
	private configureScene(): void {
		this.scene?.setConfig(this.buildSceneConfig());
	}

	protected override onGraphData(): void {
		this.pushSceneModel();
		this.offerNewScenes();
		this.scheduleAxiomsRead();
	}

	/** A cursor move changes the axioms of what the graph shows, as a change of the data does. */
	protected override onTimeCursorPaint(): void {
		super.onTimeCursorPaint();
		this.scheduleAxiomsRead();
	}

	/** Whether the main graph shows its DL view, which reads its axioms. */
	private get readsAxioms(): boolean {
		return !this.usesExternalData && this.state.dl;
	}

	/** What the scene draws, by its ids. */
	private drawnBy(scene: ShuGraphScene): TDrawn {
		return { nodes: [...scene.nodeMap.keys()], edges: scene.links.map((l) => ({ from: linkEndId(l.source), predicate: l.predicate, to: linkEndId(l.target) })) };
	}

	/** What this graph view shows, as its source's read takes it: the records of each type it reads, the reader's filter
	 *  choices, its prune, and its time cursor where it isn't at the live edge. */
	private shownView(): TGraphView {
		const cursor = this.timeline.cursor;
		return {
			perTypeLimit: this.cgState.perTypeLimit,
			accessLevel: appAccessLevel(),
			overrides: this.filterOverrides,
			hiddenPredicates: this.cgState.hiddenPredicates,
			prune: this.state.prune,
			...(cursor === null ? {} : { timeCursor: cursor }),
		};
	}

	/** Reads the axioms again where the DL view shows them, keeping what it shows until the read completes, and maps the new
	 *  read onto the nodes and edges the scene draws. */
	private readAxioms(): void {
		if (this.readsAxioms) void this.#axioms.refresh().then(() => this.mapAxioms());
	}

	/** Reads the axioms again once per window, for a change of what the graph shows that a stream or a scrub repeats. */
	private scheduleAxiomsRead(): void {
		if (this.readsAxioms) this.#clock.coalesce(AXIOMS_READ, AXIOMS_COALESCE_MS, () => this.readAxioms());
	}

	/** Maps the axioms read onto the nodes and edges the scene draws, in the DL view; outside it, the scene draws them without. The
	 *  scene redraws only where the mapping changed, so a redraw's own report of what it draws doesn't redraw it again. */
	private mapAxioms(): void {
		const [axioms, scene] = [this.#axioms.page, this.scene];
		const overlay = this.readsAxioms && axioms !== undefined && scene !== null ? axiomOverlay(this.drawnBy(scene), axioms) : null;
		if (sameOverlay(overlay, this.#overlay)) return;
		this.#overlay = overlay;
		scene?.setAxioms(overlay);
	}

	/** Opens the axioms of what the graph shows in a pane of their own, at the frame `line` names, read afresh. This bundle's panes
	 *  aren't the page's, so the request is an event, as the scene's is. */
	private async openAxioms(line: string | undefined, addToSelection: boolean): Promise<void> {
		await this.#axioms.refresh();
		const axioms = this.#axioms.page;
		if (axioms === undefined) return;
		const data: TGraphSourcePane = { ...axioms, ...(line === undefined ? {} : { line }) };
		const detail: TPaneOpen = PaneOpenSchema.parse({ pane: { paneType: "component", tag: SHU_TAG.GRAPH_SOURCE, label: `axioms (${AXIOMS_FORMAT.label})`, data }, addToSelection });
		this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail, bubbles: true, composed: true }));
	}

	/** Opens the frame that states what a reader chose in the DL view, as the axioms pane shows it. */
	private openFrameOf(carried: TCarried | undefined, addToSelection: boolean): void {
		if (carried !== undefined) void this.openAxioms(carried.frame, addToSelection);
	}

	/**
	 * A scene saved anywhere (this view, another column, a step, another session) arrives here as live data, so the
	 * offer is refreshed the moment one appears rather than only when the settings are next opened. The names come from
	 * the live quads; the scene itself is still read through the step RPC, since an observation truncates long values.
	 */
	private offerNewScenes(): void {
		const live = this.cgState.quads.filter((q) => q.namedGraph === sceneType()).map((q) => q.subject);
		if (live.some((name) => !this.sceneNames.includes(name))) void this.loadScenes();
	}

	/** A cursor move re-styles quickly (depth re-place; positions pinned): paint promptly through the scene's cursor path,
	 *  not the streamed-data window. The fresh time-filtered slice goes down first, then the prompt re-style fires. */
	protected override get timeSyncCoalesceMs(): number {
		return CURSOR_COALESCE_MS;
	}

	/** Persist each gantt-bar reschedule the scene emitted, refetch, then have the scene repaint at once. */
	private async applyReschedule(updates: RescheduleUpdate[]): Promise<void> {
		// Fail-fast: a reschedule that didn't persist must not pass silently as a moved-but-unsaved bar, surface it.
		for (const u of updates) {
			await conduit().follow(acts("GraphStepper-updateVertex", { label: u.label, id: u.id, data: u.data }), "polymorphic: drag gantt bar → reschedule task and its dependents");
		}
		await this.refetchSnapshot({ perTypeLimit: this.cgState.perTypeLimit });
		this.scene?.flushRepaint();
	}

	/** ONE path for every layout/view option: the settings element's changes and the head toggles alike: the host holds
	 *  the (persisted) state and pushes the whole config to the scene. */
	private setOption(change: Partial<z.infer<typeof PolymorphicStateSchema>>): void {
		const read = this.readsAxioms;
		// A reader who changes an option moves the view away from the scene of its last return.
		this.removeAttribute(SHU_ATTR.SCENE);
		this.setState(change);
		this.configureScene();
		// The DL view reads its axioms at once as it starts, and again where prune changes what they state; leaving it draws the
		// scene without them.
		if (this.readsAxioms && (!read || "prune" in change)) this.readAxioms();
		if (read && !this.readsAxioms) this.mapAxioms();
	}

	/** The settings element reports which option the reader touched. */
	private onSettingsChange = (change: TPolymorphicOptionChange): void => {
		this.setOption(change as Partial<z.infer<typeof PolymorphicStateSchema>>);
	};
}

defineElement(SHU_TAG.POLYMORPHIC_GRAPH_VIEW, ShuPolymorphicGraphView);
