/**
 * shu-class-browser — the schema (T-Box) host for <shu-graph-scene>: the class/property vocabulary as a live 3D graph,
 * the view a #Type reference's column embeds. A second, minimal host beside shu-polymorphic-graph-view over the same scene:
 *
 *  - Three always-visible tabs pick the view: `type only` = the focus type's OWN vocabulary (its class, properties,
 *    superclass — scopeSchemaToType), the default; `all types` = every class and property, where the focus type stays
 *    highlighted (its own focus, independent of the app-wide selection) while the rest dims; `context` = the focus type's
 *    JSON-LD @context, dereferenced from the served context document. The schema chips (Class, Property — each toggleable)
 *    stay behind the pane's view-settings control, persisted under an independent scope. It never reads or writes the
 *    main graph's choices, over a fixed layout (force view, grouped into the Class and Property containers).
 *  - Clicking a Class node opens its type column (its CLASS view); a Property node opens the windowed instances of a type
 *    that declares it (the scene's node-open-pane output).
 *
 * The data pathway is inherited from ShuClusteredGraphView (snapshot + live SSE + selection + time cursor); the scene
 * carries the schema because getClusteredQuads includes it (withOntologySchema), pruned to the terms the data uses.
 * Light DOM: the scene resolves its A-Frame camera through document.querySelector, and its chrome positions against
 * this host.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { html, type TemplateResult } from "lit";
import type { TLinkedData } from "./shu-element.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import { SHU_EVENT } from "../consts.js";
import { fetchIndividuals } from "../pane-fetch.js";
import { idOf, instanceLabel } from "../util.js";
import { renderRef } from "./ref-navigation.js";
import type { ShuGraphFilter } from "./shu-graph-filter.js";
import { scopeSchemaToType, scopeSchemaToConnected } from "../graph/ontology-projection.js";
import { prefixesReferencedBy } from "../graph/jsonld-context-scope.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { VIEW } from "../graph/polymorphic/polymorphic-views.js";
import { viewHeadCss, viewActions } from "./view-head.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import "@haibun/shu/graph/polymorphic/polymorphic-scene.js";
import { type ShuGraphScene, GRAPH_SCENE_EVENT, type GraphSceneModel } from "../graph/polymorphic/polymorphic-scene.js";

const BrowserStateSchema = z.object({
	...clusteredGraphStateShape,
	/** Which view: `type` = the focus type's own schema graph; `all` = every class and property; `context` = the focus
	 *  type's JSON-LD @context (dereferenced from the served context document, the standard way a context is fetched). */
	viewMode: z.enum(["type", "connected", "all", "context", "individuals"]).default("type"),
});

type ViewMode = "type" | "connected" | "all" | "context" | "individuals";
const MODES: readonly ViewMode[] = ["type", "connected", "all", "context", "individuals"];
const MODE_LABELS: Record<ViewMode, string> = { type: "type only", connected: "connected", all: "all types", context: "vocabulary", individuals: "individuals" };
type VertexData = Record<string, unknown>;

/** The browser's fixed layout: the schema is a small, timeless graph — one force layout, grouped by @type so the
 *  vocabulary reads as its two containers. No persisted layout choices; the only persisted state is the chip scope. */
const BROWSER_CONFIG = { viewType: VIEW.force, flatten: false, grouped: true, groupBy: "type", zBasis: "valid", labelAsZ: false } as const;

const FILTER_SCOPE = "class-browser";

// Composed statically and rendered via unsafeHTML: lit leaves bindings inside a <style> element uninterpolated,
// so the shared view-head rules cannot be interpolated in the template itself.
const BROWSER_CSS = `
	shu-class-browser { display: block; height: 100%; background: var(--shu-bg); }
	${viewHeadCss("shu-class-browser")}
	shu-class-browser shu-graph-filter { flex: 0 0 auto; }
	shu-class-browser .context-view { flex: 1 1 auto; min-height: 0; margin: 0; overflow: auto; padding: var(--shu-space-4); font-family: var(--shu-mono, ui-monospace, monospace); font-size: var(--shu-font-sm); white-space: pre-wrap; color: var(--shu-fg); background: var(--shu-bg); }
	shu-class-browser .individuals-view { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--shu-space-3) var(--shu-space-4); }
	shu-class-browser .individuals-view ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--shu-space-1); }
	shu-class-browser .individuals-view .empty { color: var(--shu-fg-muted); font-size: var(--shu-font-sm); }
	shu-class-browser .hidden { display: none; }
`;

export class ShuClassBrowser extends ShuClusteredGraphView<typeof BrowserStateSchema> {
	/** The chosen view mode is remembered across reloads, like every persisted view option. */
	static persistFields = ["viewMode"] as const;

	/** The visible graph as JSON-LD — the scene's one representation, shared with the copy-graph button. */
	summarizeForKihan(): TLinkedData | null {
		return this.scene?.graphJsonLd() ?? null;
	}

	/** The focus type's JSON-LD @context, fetched from the served context document for the context view (null until loaded). */
	private contextJson: string | null = null;

	/** The focus type's individuals for the individuals view (null until fetched), and the focus they were fetched for. */
	private individuals: VertexData[] | null = null;
	private individualsFocus = "";

	/** The scene is only in the DOM on a graph tab; this tracks the mounted element so each fresh mount is configured once. */
	private configuredSceneEl: ShuGraphScene | null = null;

	/** The focus type last applied to the scene — re-scope when it changes (focus arrives after the scene first mounts). */
	private configuredFocus = "";

	static override observedHtmlAttributes = ["data-show-controls"];

	/** The type this embed was opened for — the single-schema scope and the camera fit centre. */
	private focusType = "";

	constructor() {
		super(BrowserStateSchema, {});
	}

	/** Light DOM: the A-Frame scene resolves its camera through document, and the scene chrome positions against this host. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** The browser's chip choices persist under their own scope — never the main graph's shared filter store. */
	protected override get filterPersistScope(): string {
		return FILTER_SCOPE;
	}

	/** An independent snapshot: the browser's fetches and chip choices never replace the main graph's data, and the
	 *  main view's refetches never replace the schema shown here. Live observations still extend both. */
	protected override get snapshotScope(): string {
		return FILTER_SCOPE;
	}

	/** Always fetch the full set (the schema is small): visibility is client-side, and a full request keeps the served
	 *  schema pruned against complete evidence. */
	protected override get narrowsRefetchToVisible(): boolean {
		return false;
	}

	private get scene(): ShuGraphScene | null {
		return this.querySelector<ShuGraphScene>("shu-graph-scene");
	}

	private get filterEl(): ShuGraphFilter | null {
		return this.querySelector("shu-graph-filter");
	}

	/** Embedded mount (shu-product-view hands the product here): fit the schema around the focus type's Class node.
	 *  The scene stages it — it emits graph-scope-revealed once the clusters are known (showing only the schema chips),
	 *  then fits when the node is built. */
	openProducts(products: Record<string, unknown>): void {
		const focusType = typeof products.focusType === "string" ? products.focusType : undefined;
		if (!focusType) return;
		this.focusType = focusType;
		void this.scopeWhenReady();
	}

	/** Callable at any time relative to this element's own lifecycle: a caller that mounts and opens in the same task
	 *  arrives before the first render, so this waits for updateComplete. The scene (a graph tab) configures itself on
	 *  mount via updated(); a context or individuals tab loads its own content. */
	private async scopeWhenReady(): Promise<void> {
		this.requestUpdate();
		await this.updateComplete;
		if (this.state.viewMode === "context") void this.loadContext();
		else if (this.state.viewMode === "individuals") void this.loadIndividuals();
	}

	private setMode(mode: ViewMode): void {
		if (mode === this.state.viewMode) return;
		this.setState({ viewMode: mode });
		if (mode === "context") void this.loadContext();
		else if (mode === "individuals") void this.loadIndividuals();
		else this.pushSceneModel(); // type/all change the scene's scope
	}

	/** Dereference the served JSON-LD context document (the usual way a JSON-LD context is fetched — by URL) and keep the
	 *  focus type's scoped node plus ONLY the prefixes its own terms reference — a self-contained @context for this one
	 *  type, without the whole store's vocabulary (a credential does not use sosa/foaf/otel/wallet/…). */
	private async loadContext(): Promise<void> {
		try {
			const res = await fetch("/ns/context.jsonld");
			const ctx = ((await res.json()) as { "@context"?: Record<string, unknown> })["@context"] ?? {};
			const typeNode = ctx[this.focusType];
			const used = prefixesReferencedBy(typeNode);
			const prefixes = Object.fromEntries(Object.entries(ctx).filter(([k, v]) => (typeof v === "string" && used.has(k)) || k === "@version"));
			this.contextJson = JSON.stringify(typeNode === undefined ? prefixes : { ...prefixes, [this.focusType]: typeNode }, null, 2);
		} catch (err) {
			this.contextJson = `Could not fetch /ns/context.jsonld: ${errorDetail(err)}`;
		}
		this.requestUpdate();
	}

	/** The focus type's individuals for the individuals view — the same bounded slice the type column lists. */
	private async loadIndividuals(): Promise<void> {
		if (!this.focusType || this.individualsFocus === this.focusType) return; // already loaded (or loading) for this focus
		this.individualsFocus = this.focusType;
		const res = await fetchIndividuals(this.focusType, `class-browser individuals: ${this.focusType}`);
		this.individuals = res.ok ? (res.value.vertices ?? []) : [];
		this.requestUpdate();
	}

	override render(): TemplateResult {
		const mode = this.state.viewMode;
		const graphHidden = mode === "context" || mode === "individuals";
		return html`
			${unsafeHTML(`<style>${BROWSER_CSS}</style>`)}
			<div class="view-root">
			<div class="view-head">
				<div class="view-controls">
					<label>show
						<select data-testid=${SHU_TEST_IDS.CLASS_BROWSER.MODE} .value=${mode} @change=${(e: Event) => this.setMode((e.target as HTMLSelectElement).value as ViewMode)}>
							${MODES.map((m) => html`<option value=${m} ?selected=${mode === m}>${MODE_LABELS[m]}</option>`)}
						</select>
					</label>
					${
						// The browser's layout is fixed (BROWSER_CONFIG), so it has no options to settle behind the ⚙ — only the
						// two actions every graph host offers, and only while a graph is on screen to act on.
						graphHidden
							? html``
							: viewActions({
									fitId: SHU_TEST_IDS.CLASS_BROWSER.FIT,
									copyId: SHU_TEST_IDS.CLASS_BROWSER.COPY_GRAPH,
									onFit: () => this.scene?.fitGraph(),
									getCopyText: () => this.scene?.graphCopyText() ?? "",
									rotate: { xyId: SHU_TEST_IDS.CLASS_BROWSER.ROTATE_XY, zId: SHU_TEST_IDS.CLASS_BROWSER.ROTATE_Z, onRotate: (aim) => this.scene?.rotateTo(aim) },
								})
					}
				</div>
			</div>
			<shu-graph-filter class=${graphHidden ? "hidden" : ""} data-schema-only data-persist-scope=${FILTER_SCOPE}></shu-graph-filter>
			<!-- The scene is mounted only on a graph tab (not CSS-hidden) so its render loop never runs on a text tab. -->
			${!graphHidden ? html`<div class="graph-area"><shu-graph-scene></shu-graph-scene></div>` : ""}
			${mode === "context" ? html`<pre class="context-view" data-testid=${SHU_TEST_IDS.CLASS_BROWSER.CONTEXT_VIEW}>${this.contextJson ?? "Loading context…"}</pre>` : ""}
			${mode === "individuals" ? this.renderIndividuals() : ""}
			</div>
		`;
	}

	private renderIndividuals(): TemplateResult {
		const list = this.individuals;
		if (list === null) return html`<div class="individuals-view"><span class="empty">Loading…</span></div>`;
		return html`<div class="individuals-view" data-testid=${SHU_TEST_IDS.CLASS_BROWSER.INDIVIDUALS_VIEW}>
			${list.length ? html`<ul>${list.map((v) => html`<li>${unsafeHTML(renderRef("entity", { persistedAs: this.focusType, id: idOf(v) }, instanceLabel(v)))}</li>`)}</ul>` : html`<span class="empty">No individuals.</span>`}
		</div>`;
	}

	protected override onAttributeChanged(name: string): void {
		if (name === "data-show-controls") this.requestUpdate();
	}

	/** The filter row shows only while the column's view-settings toggle (the pane gear, data-show-controls) is on —
	 *  the same gate every view's filter uses. The scene is only in the DOM on a graph tab; configure it on each mount. */
	protected updated(): void {
		const f = this.filterEl;
		if (f) {
			if (this.showControls) f.setAttribute("show-controls", "");
			else f.removeAttribute("show-controls");
		}
		const scene = this.scene;
		if (!scene) {
			this.configuredSceneEl = null;
			return;
		}
		const freshMount = scene !== this.configuredSceneEl;
		if (freshMount) {
			this.configuredSceneEl = scene;
			scene.setConfig(BROWSER_CONFIG);
		}
		// Re-scope on a fresh mount OR when the focus type arrives after the scene (openProducts runs after first render).
		if (freshMount || this.focusType !== this.configuredFocus) {
			this.configuredFocus = this.focusType;
			if (this.focusType) {
				scene.scopeToType(this.focusType);
				scene.setSelectedSubject(this.focusType);
			}
			this.pushSceneModel();
		}
	}

	protected override async onGraphConnected(): Promise<void> {
		await this.updateComplete; // renders the filter and creates the <shu-graph-scene> child
		this.setAttribute("data-testid", SHU_TEST_IDS.CLASS_BROWSER.ROOT);

		// Relay the scene's neutral outputs to the app's events — node navigation identical to the main graph view.
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_CLICK, ((e: CustomEvent<{ label: string; subject: string; addToSelection: boolean }>) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_OPEN_PANE, ((e: CustomEvent) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.SCOPE_REVEALED, ((e: CustomEvent<{ types: string[] }>) => {
			this.filterEl?.setVisibleTypes(e.detail.types);
		}) as EventListener);
		// Hovering a chip previews its cluster: every other type dims, exactly as in the main graph.
		this.autoListen(this, SHU_EVENT.GRAPH_TYPE_PREVIEW, ((e: CustomEvent<{ type: string | null }>) => {
			this.scene?.setPreviewType(e.detail?.type ?? null);
		}) as EventListener);
	}

	/** The browser's data slice: the full vocabulary, or — in single-type scope — the focus type's own schema. */
	private scopedQuads(quads: TQuad[]): TQuad[] {
		if (this.state.viewMode === "all" || !this.focusType) return quads;
		if (this.state.viewMode === "connected") return scopeSchemaToConnected(quads, this.focusType);
		return scopeSchemaToType(quads, this.focusType);
	}

	private buildSceneModel(): GraphSceneModel {
		return {
			quads: this.scopedQuads(this.cgState.quads),
			visibleQuads: this.scopedQuads(this.visibleQuads),
			clusters: this.cgState.clusters,
			knownClusters: this.knownClusters,
			hiddenPredicates: this.cgState.hiddenPredicates,
			hiddenGraphs: this.cgState.hiddenGraphs,
			site: this.cgState.site,
			perTypeLimit: this.cgState.perTypeLimit,
			timeCursor: this.timeCursor,
		};
	}

	private pushSceneModel(): void {
		this.filterEl?.setSource(this.knownClusters, this.cgState.quads);
		this.scene?.setModel(this.buildSceneModel());
	}

	protected override onGraphData(): void {
		this.pushSceneModel();
	}

	/** Each type view highlights ITS OWN focus type — its Class, with its properties and superclass lit through the focus
	 *  policy. The app-wide selection is global, so another type view opening (publishing a different type) must NOT switch
	 *  this one: pin the highlight to the focus type. Only a scope with no focus (unusual) follows the shared selection. */
	protected override onGraphSelection(subject: string | null): void {
		this.scene?.setSelectedSubject(this.focusType || subject);
	}

	protected override onTimeCursorPaint(): void {
		this.pushSceneModel();
		this.scene?.setTimeCursorValue(this.timeCursor);
	}
}

if (!customElements.get("shu-class-browser")) {
	customElements.define("shu-class-browser", ShuClassBrowser);
}
