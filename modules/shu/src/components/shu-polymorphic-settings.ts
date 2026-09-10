/**
 * shu-polymorphic-settings: the controls of ONE settings group (`group`: layout or scenes), rendered inside the
 * head's open settings row. The head's group icons decide which group is open; this element renders that group's
 * controls. The surface is a property of the polymorphic view component, not of one embedding: every instance gets the same
 * options in the same place because they come from the same element.
 *
 * It owns NO state. The host owns the options (a Zod schema + setState + persistFields) and pushes them to the scene;
 * this element renders what it is given and reports the reader's intent back through `onChange`. Data it needs to render
 * an option (the group-by axes) arrives as a property: a component never reaches the RPC for it.
 *
 * `fit` and `copy graph` are NOT here: they are actions, not options, and stay directly reachable on the view head.
 * The orientation group holds only actions (the two head-on aims), so the host renders it directly.
 */
import { SHU_TEST_IDS } from "../test-ids.js";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
// The view catalog itself, never the render-type module that re-exports it: that pulls the whole 3D layout chain in
// behind a name this element only reads.
import { VIEW_TYPES, VIEW_LABELS, type ViewType } from "../graph/polymorphic/polymorphic-views.js";
import type { GraphSceneConfig } from "../graph/polymorphic/polymorphic-scene.js";
import type { TViewForces } from "../graph/polymorphic/polymorphic-render-type.js";
import "@haibun/shu/components/shu-field.js";

const IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;

/** The options a reader sets: the scene's own config, which is what every one of them ends up setting. */
export type TPolymorphicOptions = GraphSceneConfig;

/** Reported when a control changes: the one option the reader touched, for the host to merge into its own state. */
export type TPolymorphicOptionChange = Partial<TPolymorphicOptions>;

export class ShuPolymorphicSettings extends ShuElement<z.ZodType> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	/** Reactive, so the host re-rendering with new options re-renders these controls: a plain field would leave the
	 *  first render standing (a lane view's group/group-by would keep showing). Never attributes: they are objects and a
	 *  callback, handed down by property binding. */
	static properties = {
		group: { attribute: false },
		options: { attribute: false },
		groupByAxes: { attribute: false },
		forces: { attribute: false },
		scenes: { attribute: false },
		sceneError: { attribute: false },
		onChange: { attribute: false },
		onApplyScene: { attribute: false },
		onSaveScene: { attribute: false },
	};

	// `declare`, never a class field: a field would define an own property that shadows lit's reactive accessor, so the
	// host handing down new options would never re-render these controls (lit.dev/msg/class-field-shadowing).
	/** Which settings group this instance renders. */
	declare group: "layout" | "scenes";
	/** The host's current options, rendered, never stored. Set by the host that owns them. */
	declare options: TPolymorphicOptions;
	/** The axes the scene derives from its data, handed down by the host. */
	declare groupByAxes: string[];
	/** What the active view FORCES: an option it settles is not offered here, since a control that cannot act is a
	 *  control that lies. A lane view forces grouping, flatten and label-as-depth, so its rows carry only what applies. */
	declare forces: TViewForces;
	/** Reports the reader's intent. The host decides what it means. */
	declare onChange: (change: TPolymorphicOptionChange) => void;
	/** The scenes saved here, for a reader to return to one. Handed down; a component never reaches the RPC itself. */
	declare scenes: string[];
	/** What went wrong with the last scene asked for, shown beside the controls. Null when nothing did. */
	declare sceneError: string | null;
	/** Reports that the reader picked a saved scene to return to. */
	declare onApplyScene: (name: string) => void;
	/** Reports that the reader named this view and saved it. */
	declare onSaveScene: (name: string) => void;

	constructor() {
		super(z.object({}), {});
		this.group = "layout";
		this.groupByAxes = ["type", "role"];
		this.forces = {};
		this.scenes = [];
		this.sceneError = null;
		this.onChange = () => {
			throw new Error("shu-polymorphic-settings reports intent to its host: set .onChange");
		};
		this.onApplyScene = () => {
			throw new Error("shu-polymorphic-settings reports intent to its host: set .onApplyScene");
		};
		this.onSaveScene = () => {
			throw new Error("shu-polymorphic-settings reports intent to its host: set .onSaveScene");
		};
	}

	/** Light DOM, as the host: the settings are slotted into the host's filter, and a shadow root would break the slot. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	override render(): TemplateResult {
		// One group holds how the graph is laid out: what it reads as and how it gathers, then what places its depth.
		if (this.group === "layout") return html`${this.renderLayout()}${this.renderDepth()}`;
		return this.renderScenes();
	}

	/** ∠ layout: what the graph reads as, and how it gathers. Its depth controls follow, and the head-on aims come from
	 *  the host, so the row reads as one choice about how the graph stands. */
	private renderLayout(): TemplateResult {
		const o = this.options;
		return html`
			<shu-field label="view">
				<select data-testid=${IDS.VIEW_TYPE} .value=${o.viewType} @change=${(e: Event) => this.onChange({ viewType: (e.target as HTMLSelectElement).value as ViewType })}>
					${VIEW_TYPES.map((v) => html`<option value=${v} ?selected=${o.viewType === v}>${VIEW_LABELS[v]}</option>`)}
				</select>
			</shu-field>
			${
				!this.offers("grouped")
					? html``
					: html`<shu-field label="group" trailing>
							<input type="checkbox" data-testid=${IDS.GROUPED} .checked=${o.grouped} @change=${(e: Event) => this.onChange({ grouped: (e.target as HTMLInputElement).checked })}>
						</shu-field>
						<shu-field label="by">
							<select data-testid=${IDS.GROUP_BY} .value=${o.groupBy} @change=${(e: Event) => this.onChange({ groupBy: (e.target as HTMLSelectElement).value })}>
								${this.groupByAxes.map((axis) => html`<option value=${axis} ?selected=${o.groupBy === axis}>${axis}</option>`)}
							</select>
						</shu-field>`
			}
		`;
	}

	/** ⧗ depth: everything about the z axis, whether it exists (flatten), what places it, whether chips are labelled by it. */
	private renderDepth(): TemplateResult {
		const o = this.options;
		return html`
			${
				this.offers("flatten")
					? html`<shu-field label="flatten" trailing>
						<input type="checkbox" data-testid=${IDS.FLATTEN} .checked=${o.flatten} @change=${(e: Event) => this.onChange({ flatten: (e.target as HTMLInputElement).checked })}>
					</shu-field>`
					: ""
			}
			<shu-field label="depth by">
				<select data-testid=${IDS.Z_BASIS} .value=${o.zBasis} @change=${(e: Event) => this.onChange({ zBasis: (e.target as HTMLSelectElement).value as TPolymorphicOptions["zBasis"] })}>
					<option value="valid">valid time</option>
					<option value="indexed">indexed time</option>
					<option value="connections"># connections</option>
				</select>
			</shu-field>
			${
				this.offers("labelAsZ")
					? html`<shu-field label="label as depth" trailing>
						<input type="checkbox" data-testid=${IDS.LABEL_AS_Z} .checked=${o.labelAsZ} @change=${(e: Event) => this.onChange({ labelAsZ: (e.target as HTMLInputElement).checked })}>
					</shu-field>`
					: ""
			}
		`;
	}

	/** Whether the active view leaves this option to the reader. A view that FORCES a value settles it, so offering the
	 *  control would offer a choice that cannot be made: one test, used by every option that a view can settle. */
	private offers(option: keyof TViewForces): boolean {
		return this.forces[option] === undefined;
	}

	/** ☆ scenes: return to a saved way of looking, or name and save this one. */
	private renderScenes(): TemplateResult {
		return html`
			<shu-field label="go to">
				<select data-testid=${IDS.SCENE_PICKER} @change=${(e: Event) => this.onApplyScene((e.target as HTMLSelectElement).value)}>
					<option value="">scene</option>
					${this.scenes.map((name) => html`<option value=${name}>${name}</option>`)}
				</select>
			</shu-field>
			<shu-field label="save as">
				<input type="text" data-testid=${IDS.SCENE_NAME} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.saveNamed()}>
				<button type="button" data-testid=${IDS.SCENE_SAVE} @click=${() => this.saveNamed()}>save</button>
			</shu-field>
			${this.sceneError ? html`<span class="error" data-testid=${IDS.SCENE_ERROR}>${this.sceneError}</span>` : ""}
		`;
	}

	/** Save this view under the name the reader typed. An unnamed scene could not be returned to, so nothing is saved. */
	private saveNamed(): void {
		const input = this.querySelector<HTMLInputElement>(`[data-testid="${IDS.SCENE_NAME}"]`);
		const name = input?.value.trim();
		if (!name) return;
		this.onSaveScene(name);
	}
}

customElements.define("shu-polymorphic-settings", ShuPolymorphicSettings);
