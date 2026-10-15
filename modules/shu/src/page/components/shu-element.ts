/**
 * `ShuElement<T>`: base for every Shu web component. Extends `LitElement`
 * so each component gets DOM diffing, focus preservation, and batched
 * update scheduling natively. The Zod schema acts as both the wire
 * contract and the runtime guard for `setState`.
 *
 * Pattern every subclass follows:
 *
 *   class Foo extends ShuElement<typeof FooSchema> {
 *     constructor() { super(FooSchema, FooDefaults); }
 *     render() { return html`<div>${this.state.label}</div>`; }
 *   }
 *
 * `render()` returns a lit-html `TemplateResult`; Lit reconciles it against
 * the prior tree, preserving focus on inputs whose identity hasn't changed
 * and skipping work on unchanged subtrees. Components don't write to
 * `innerHTML` directly.
 *
 * `setState(partial)` validates the merged state against the schema and
 * assigns it to the reactive `state` property, Lit batches the re-render
 * into the next microtask. State mutations are whole-object replacements
 * so Lit's change detection (===) fires correctly.
 *
 * A view that shows actuality at the time cursor holds a `TimelineViewController`, and a view that stores fields across
 * reloads names them in `persistFields`, which `PreferencesController` stores. The active-view signal (`activePane`) is
 * wired by #installActiveView, and a subclass overrides `onViewActive(active)` to react.
 *
 * Inbound event subscriptions go through `subscribeBatched({onBatch, filter})`
 * which coalesces every event arriving between paints into one handler call
 * inside an animation frame. The transport is the installed `TEventStream`
 * (`event-stream.ts`); subscribers never construct `SseSubscriber` directly.
 *
 * Light DOM: components that must live in the host's light DOM (e.g.
 * embedded 3D scenes whose `document.querySelector` lookups need to
 * resolve their children) override `createRenderRoot()` to return `this`.
 */

import { errorDetail } from "@haibun/core/lib/util/index.js";
import { LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { z } from "zod";
import { SHU_TAG, SHU_ATTR, SHU_EVENT, SPINE_SLOT } from "../../domains/elements.js";
import { activePane } from "../controllers/page-cell-controller.js";
import type { TSharedCell } from "../ports.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { unwrap as unwrapWrappers } from "@haibun/core/lib/zod-unwrap.js";
// Re-exported so every view can annotate its summarizeForContext as `TLinkedData | null` from the same import it already
// takes for ShuElement, instead of each reaching into core for the node-object type.
/** The state of a component that doesn't hold any of its own. */
export const EmptyStateSchema = z.object({});

export type { TLinkedData };
import { getRels } from "../controllers/catalog-controller.js";
import { recordTime } from "../derivations/record-fields.js";
import * as PageHash from "../controllers/hash-controller.js";
import { subscribeBatchedEvents } from "../controllers/event-stream-controller.js";
import { type TEvent, type TEventFilter } from "../ports.js";
import { PreferencesController } from "../controllers/preferences-controller.js";
import { recordClientBlip } from "../controllers/blip-controller.js";
import type { TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";

export abstract class ShuElement<T extends z.ZodObject> extends SignalWatcher(LitElement) {
	/** Get the current view hash, from URL when a live `window.location` is present, from stored state when running in an offline standalone HTML file. */
	static getHash(): string {
		return PageHash.getHash();
	}

	/** Update view hash. Online: writes to URL. Offline: updates stored state only. */
	static pushHash(newHash: string): void {
		PageHash.pushHash(newHash);
	}

	/** Extra HTML attributes a subclass wants observed, beyond lit's reactive-property attributes. Declare this static array instead of overriding `observedAttributes` directly: lit computes `elementStyles` lazily inside its `observedAttributes` getter, so a raw override that skips `super` never triggers `finalize()` and the component silently inherits the base's empty styles: every `static styles` rule is dropped from the shadow root. */
	static observedHtmlAttributes: string[] = [];

	/** Map of observed HTML attribute → state field. The base reflects each into `state` through the Zod schema:
	 * coerced by the field's type (string / boolean-by-presence / number / enum), validated by setState: an invalid
	 * value throws, it never silently defaults. Declare this instead of a hand-written attributeChangedCallback
	 * if-chain. The attribute stays the source of truth; state mirrors it one-way (state doesn't reflect, so updates don't loop; CSS
	 * `:host([attr])` keeps working). Use onAttributeChanged only for side effects beyond state (e.g. syncing a child DOM node). */
	static attributeFields: Record<string, string> = {};

	static get observedAttributes(): string[] {
		// Every view reads the pane's settings control through `showControls`, so the base watches that attribute for all of
		// them, and a view doesn't declare it.
		return [...super.observedAttributes, ...Object.keys(this.attributeFields), SHU_ATTR.SHOW_CONTROLS, ...this.observedHtmlAttributes];
	}

	/** State fields remembered across reloads: THE mechanism for any persisted UI option, declared like
	 * `attributeFields` and wired by the base: `setState` write-through-persists them (debounced, via
	 * element-prefs) and the sealed connect path restores them before `onConnected`. A field set explicitly
	 * via setState earlier in this element's lifetime (e.g. a URL-hash flag applied before attach) is never
	 * overwritten by the remembered value. Do not hand-roll component cookies, declare the field here. */
	static persistFields: readonly string[] = [];

	/** Set by a column whose spine is a narrow form of ITSELF rather than a separate view the pane mounts. The pane keeps
	 *  rendering such a column while it is collapsed and marks it as serving as the spine; the column renders only what
	 *  fits the strip. This is for a column whose strip is a part it already owns: the log's own scroll rail, which is
	 *  already the right shape and already drives the scroll a separate copy would have to be kept in step with. */
	static rendersOwnSpine = false;

	/** Whether a reader acting in this view's pane makes that pane the active pane. A view the reader uses to act on another
	 *  view, as the actions bar is, doesn't, so the pane the page reads as active stays the view the reader acts on. */
	static activates = true;

	/**
	 * A spine view stays attached while its column is open, so it keeps hearing what it needs to be current the moment
	 * the column collapses. Attached is not shown, though: until the pane's spine slot takes it, the page doesn't show what it
	 * renders, and rendering it anyway takes the same as rendering it for a reader. So it holds off, and the pane asks
	 * it to catch up when the spine slot takes it.
	 */
	protected override shouldUpdate(changed: Map<PropertyKey, unknown>): boolean {
		// Only a view MOUNTED into the pane's spine slot holds off: a view that isn't assigned to a slot is the one the pane is not
		// showing. A column rendering its own spine is marked `spine` without being slotted at all, and it is on screen,
		// so it renders, which is why this asks about the slot rather than about serving as a spine.
		if (this.getAttribute("slot") === SPINE_SLOT && !this.assignedSlot) return false;
		return super.shouldUpdate(changed);
	}

	/** Identity under which `persistFields` store: "" (default) is a per-tag singleton; a multi-instance
	 * component overrides this with its instance identity (e.g. a column key); null means "the identity isn't known yet,
	 * don't persist". */
	protected get persistKey(): string | null {
		return "";
	}

	/** Reactive state. Subclasses read via `this.state`; mutations go through `setState`. The Zod schema is the runtime contract. */
	@property({ attribute: false })
	accessor state!: z.infer<T>;

	private readonly _schema: T;
	#teardowns: Array<() => void> = [];
	#dirtyFields = new Set<string>();
	#restoring = false;
	readonly #preferences = new PreferencesController(this, this.#storedFields());

	/** Record one fine-grained occurrence of this view's behaviour, at whatever rate it happens: held in the page's
	 *  fixed ring and handed to actuality in batches, which doesn't retain them. The view attribution is this element's
	 *  hosting column (or the element itself when unhosted), so any control emits with one call and without plumbing of its
	 *  own. The name must be declared in `view-blips.ts`, where the vocabulary lives. */
	protected recordBlip(name: string, value?: number, attributes?: Record<string, unknown>): void {
		const root = this.getRootNode();
		const view = root instanceof ShadowRoot ? root.host.localName : this.localName;
		recordClientBlip(name, value, { view, ...attributes });
	}

	#collapsedColumn = false;

	/**
	 * Whether the column hosting this view is collapsed to its strip, rather than open.
	 *
	 * Ambient, and true at any depth: a view nested inside another view's shadow root gets the same answer as the column
	 * itself, without each layer between passing it down. That threading is what it replaces: the pane told the column,
	 * the column told the scroller, and anything below that could not be told at all.
	 *
	 * Distinct from the `spine` attribute, which is an INSTRUCTION to one column ("you are the strip now, render
	 * narrow"). This is a fact about the surroundings that anything may read: a scroll rail doesn't draw a thumb in a strip,
	 * since the strip doesn't show content for a thumb to measure.
	 */
	protected get columnCollapsed(): boolean {
		return this.#collapsedColumn;
	}

	/** The column-pane hosting this view, across shadow boundaries, `closest` stops at the first shadow root, and most
	 *  views are nested inside one. */
	#hostingColumn(): HTMLElement | null {
		let node: Element | null = this;
		while (node) {
			if (node.tagName.toLowerCase() === SHU_TAG.COLUMN_PANE) return node as HTMLElement;
			const parent: Element | null = node.parentElement;
			if (parent) {
				node = parent;
				continue;
			}
			const root = node.getRootNode();
			node = root instanceof ShadowRoot ? (root.host as Element) : null;
		}
		return null;
	}

	/** Follow the hosting column's collapsed state. Watched on the pane's own attribute, which is the pane's single
	 *  writer of it, so a copy doesn't need to be kept in step, and an event doesn't route down through the views between. */
	#installColumnDisplay(): void {
		const pane = this.#hostingColumn();
		if (!pane) return;
		const read = (): void => {
			const collapsed = pane.hasAttribute(SHU_ATTR.COLLAPSED);
			if (collapsed === this.#collapsedColumn) return;
			this.#collapsedColumn = collapsed;
			this.requestUpdate();
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(pane, { attributes: true, attributeFilter: [SHU_ATTR.COLLAPSED] });
		this.#teardowns.push(() => observer.disconnect());
	}

	/** The context patterns of what this view shows, where it shows a record or a type: what the reader is on while this
	 *  is the active pane, and what an ask from here is about. A view without a subject of its own (a log, a document, a
	 *  conversation) doesn't state one, so activating it doesn't move the reader. */
	paneSubject(): TContextPattern[] | null {
		return null;
	}

	/** Whether this view is the strip's active pane: its containing column-pane's key equals the global `activePane`
	 *  signal. Derived, never stored: the signal is the one source of truth (reading it here auto-subscribes an in-bundle
	 *  render; a cross-bundle view reacts via #installActiveView). */
	protected get isActiveView(): boolean {
		const pane = this.closest("shu-column-pane") as HTMLElement | null;
		const key = pane?.dataset.columnKey ?? pane?.getAttribute("column-type") ?? null;
		return key !== null && key === activePane.get();
	}

	// A view states its initial state here, as a machine states its own (CA4D7). An element whose state is empty passes its
	// schema alone, which parses the empty object.
	constructor(schema: T, defaults?: z.input<T>) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults ?? {});
		this.#initial = this.state;
		// Fail fast on a typo'd persistFields entry: a name absent from the schema would otherwise silently never persist.
		const persisted = (this.constructor as typeof ShuElement).persistFields;
		for (const f of persisted) if (!schema.shape[f]) throw new Error(`<${this.localName}>: persistFields names "${f}", which is absent from the schema`);
		this.#assertSealedLifecycle();
	}

	// Fail fast: a subclass that overrides a sealed lifecycle method (instead of the onX hook) would silently
	// bypass the base's super-call chain (SignalWatcher cleanup, lit attribute reflection). Throw at construction.
	#assertSealedLifecycle(): void {
		for (const m of ["connectedCallback", "disconnectedCallback", "attributeChangedCallback"] as const) {
			if (this[m] !== ShuElement.prototype[m]) {
				const hook = m === "connectedCallback" ? "onConnected" : m === "disconnectedCallback" ? "onDisconnected" : "onAttributeChanged";
				throw new Error(`<${this.localName}> overrides sealed ShuElement.${m}(), override protected ${hook}() instead.`);
			}
		}
	}

	get schema(): T {
		return this._schema;
	}

	/** The state the element starts in, which an absent bound attribute reads as. */
	#initial: z.infer<T>;

	/** The state read by field name, as the base reads the fields a subclass names in persistFields and attributeFields. */
	get #fields(): Record<string, unknown> {
		return this.state;
	}

	/** Shallow-merge a partial into state, validate against the schema, and assign it. The `@property accessor state` setter schedules the re-render off the new (Zod-parsed) reference; this also emits `SHU_EVENT.STATE_CHANGE` so external listeners (e.g. test harnesses) observe transitions. Throws if the merged shape fails schema validation, by contract a caller error. Merge is shallow by design (state is treated as a whole-object replacement so `===` change detection fires); pass the full sub-object to update a nested field. */
	protected setState(partial: Partial<z.infer<T>>): void {
		try {
			this.state = this._schema.parse({ ...(this.state as object), ...partial });
		} catch (error) {
			// A raw ZodError names only the field, not which element, which write, or what value. setState is
			// re-entrant (state → attribute → attributeChangedCallback → setState), so the stack alone does not show either.
			throw new Error(`<${this.tagName.toLowerCase()}> setState ${describeStateWrite(partial)}: ${error instanceof z.ZodError ? z.prettifyError(error) : String(error)}`, {
				cause: error,
			});
		}
		if (!this.#restoring) {
			for (const k of Object.keys(partial)) this.#dirtyFields.add(k);
			this.#preferences.changed(Object.keys(partial));
		}
		// Reflect any changed attributeFields back onto their attributes (inverse of #reflectAttribute), including during
		// a restore, so a bound attribute a subclass declared (e.g. a pane's `pinned`) stays in sync without per-caller code.
		this.#reflectFieldsToAttributes(Object.keys(partial));
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STATE_CHANGE, { detail: this.state, bubbles: true, composed: true }));
	}

	/**
	 * The options this element would carry across a reload, as a scene records them: exactly its `persistFields`, read
	 * off the live state. A saved view is therefore the same set of choices the element already treats as durable: the
	 * element doesn't keep a second list in step with this one.
	 */
	captureSceneState(): Record<string, unknown> {
		const state = this.#fields;
		const out: Record<string, unknown> = {};
		for (const field of (this.constructor as typeof ShuElement).persistFields) if (state[field] !== undefined) out[field] = state[field];
		return out;
	}

	/**
	 * Set the options a scene recorded, through the ordinary `setState`, so the element validates them against its own
	 * schema, re-renders, and remembers them exactly as if a reader had chosen them. A scene naming an option this
	 * element does not remember is a scene for a different view: it fails rather than half-applying.
	 */
	applySceneState(fields: Record<string, unknown>): void {
		const declared = (this.constructor as typeof ShuElement).persistFields;
		for (const name of Object.keys(fields)) {
			if (!declared.includes(name)) throw new Error(`<${this.tagName.toLowerCase()}>: a scene names the option "${name}", which this view does not remember`);
		}
		this.setState(fields as Partial<z.infer<T>>);
	}

	/** Removes this instance's stored `persistFields`. A view the reader closes calls it, so the next instance under the same
	 *  key opens with its initial state. A view that is removed and returns, as on a reload, doesn't call it. */
	protected forgetPersisted(): void {
		this.#preferences.forget();
	}

	/** The fields `PreferencesController` stores: the `persistFields`, under this element's tag and `persistKey`. On the
	 *  first connection, a field that this element set before it connected stays as set. Throws where the schema refuses the
	 *  stored fields. */
	#storedFields(): ConstructorParameters<typeof PreferencesController>[1] {
		const element = this;
		const names = (this.constructor as typeof ShuElement).persistFields;
		return {
			get tag() {
				return element.tagName.toLowerCase();
			},
			key: () => this.persistKey,
			names,
			fields: () => Object.fromEntries(names.filter((name) => this.#fields[name] !== undefined).map((name) => [name, this.#fields[name]])),
			restore: (saved, initial) => {
				const patch = Object.fromEntries(Object.entries(saved).filter(([name]) => !initial || !this.#dirtyFields.has(name)));
				if (Object.keys(patch).length === 0) return;
				const parsed = this._schema.safeParse({ ...(this.state as object), ...patch });
				if (!parsed.success) throw new Error(`the fields stored for <${element.tagName.toLowerCase()}> don't match its schema (${errorDetail(parsed.error)}). Remove its cookie.`);
				this.#restoring = true;
				try {
					this.setState(patch as Partial<z.infer<T>>);
				} finally {
					this.#restoring = false;
				}
			},
		};
	}

	protected validate(data: unknown): z.infer<T> {
		return this._schema.parse(data);
	}

	protected safeValidate(data: unknown): { success: boolean; data?: z.infer<T>; error?: z.ZodError } {
		const result = this._schema.safeParse(data);
		return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
	}

	// SEALED: do not override in a subclass. Override the protected onConnected/onDisconnected/onAttributeChanged
	// hooks instead; the base owns the super-call chain so SignalWatcher cleanup and lit attribute reflection
	// can never be silently skipped. A subclass that overrides any of these throws at construction (see #assertSealed).
	connectedCallback(): void {
		super.connectedCallback();
		this.#installActiveView();
		this.#installColumnDisplay();
		this.onConnected();
	}

	disconnectedCallback(): void {
		this.onDisconnected();
		for (const teardown of this.#teardowns.splice(0)) teardown();
		super.disconnectedCallback();
	}

	attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
		super.attributeChangedCallback(name, oldValue, newValue);
		this.#reflectAttribute(name, newValue);
		if (name === SHU_ATTR.SHOW_CONTROLS) this.requestUpdate();
		this.onAttributeChanged(name, oldValue, newValue);
	}

	/** Reflect a bound attribute (declared in static attributeFields) into state via the schema; setState validates (fail-fast). */
	#reflectAttribute(name: string, val: string | null): void {
		const field = (this.constructor as typeof ShuElement).attributeFields[name];
		if (!field) return;
		const fieldSchema = this._schema.shape[field];
		if (!fieldSchema) throw new Error(`<${this.localName}>: attributeFields maps "${name}" → state field "${field}", which is absent from the schema`);
		// An absent attribute reads as the field's initial state (CA4D7): the inverse write removes an attribute that holds
		// the initial state, so reading the removal back as another value would reject state the element holds.
		const value = val === null ? (this.#initial as Record<string, unknown>)[field] : coerceAttribute(fieldSchema, val);
		// The state already holds what the attribute holds, so this change reports the element's own write and the element
		// doesn't have a value to write. The element compares the value rather than timing its own writes, since the browser delivers
		// the reactions it holds for other attributes whenever the element writes one.
		if (this.#fields[field] === value) return;
		try {
			this.setState({ [field]: value } as Partial<z.infer<T>>);
		} catch (error) {
			// Name the attribute that drove the write: setState reports the state it rejected, not where that state came from.
			throw new Error(`<${this.tagName.toLowerCase()}> attribute ${name}=${JSON.stringify(val)} → state.${field}: ${errorDetail(error)}`, { cause: error });
		}
	}

	/** Reflect every changed attributeField state value back onto its bound attribute (inverse of #reflectAttribute). The
	 *  change each write reports reaches #reflectAttribute, which reads it as the state the element already holds. Fields
	 *  without a bound attribute are ignored. */
	#reflectFieldsToAttributes(changed: string[]): void {
		const attributeFields = (this.constructor as typeof ShuElement).attributeFields;
		const bound = Object.entries(attributeFields).filter(([, field]) => changed.includes(field));
		if (bound.length === 0) return;
		for (const [attr, field] of bound) reflectAttributeValue(this, attr, this._schema.shape[field], this.#fields[field], (this.#initial as Record<string, unknown>)[field]);
	}

	// A view that overrides onViewActive reacts to the active-pane signal across bundles
	// through the shared signal bus, and only when its OWN active state flips (the signal fires on every pane switch).
	#installActiveView(): void {
		if (this.onViewActive === ShuElement.prototype.onViewActive) return;
		let prev = this.isActiveView;
		this.watchSignal(activePane, () => {
			const now = this.isActiveView;
			if (now === prev) return;
			prev = now;
			this.onViewActive(now);
		});
	}

	/** Lit's render contract, return a TemplateResult. */
	abstract render(): TemplateResult;

	/**
	 * What this view presents, summarized for a conversation as linked data: a JSON-LD node (`@id`, `@type`, and the
	 * view's content or a faithful digest of it). Called ON DEMAND by the chat-context harvester when the person
	 * asks: never on render, so a large summary isn't computed until the ask is sent. A view on screen the
	 * model cannot read is a broken ask; return null only for a pure control that doesn't present data (a picker, a
	 * button strip): the decision is required of every view, never implicit.
	 */
	abstract summarizeForContext(): TLinkedData | null;

	/** Called when this view's active state toggles. Default no-op; override for custom behavior. */
	protected onViewActive(_active: boolean): void {
		// no-op default; subclasses override.
	}

	/** Override instead of connectedCallback. Runs after super.connectedCallback() and the time-sync effect are installed. */
	protected onConnected(): void {
		// no-op default; subclasses override
	}

	/** Override instead of disconnectedCallback. Runs before super.disconnectedCallback() (SignalWatcher teardown). Side-effect-only cleanup. */
	protected onDisconnected(): void {
		// no-op default; subclasses override
	}

	/** Override instead of attributeChangedCallback. Runs after lit's attribute→property reflection. */
	protected onAttributeChanged(_name: string, _oldValue: string | null, _newValue: string | null): void {
		// no-op default; subclasses override
	}

	/** addEventListener that auto-removes on disconnect. Register in onConnected; the sealed disconnect path tears it
	 * down: so a component doesn't need an onDisconnected body and can never leak a forgotten removeEventListener. */
	protected autoListen(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void {
		target.addEventListener(type, handler, opts);
		this.#teardowns.push(() => target.removeEventListener(type, handler, opts));
	}

	/** Register an arbitrary cleanup (a subscribe() unsub, ResizeObserver.disconnect, clearTimeout, …) to run on disconnect. */
	protected autoTeardown(cleanup: () => void): void {
		this.#teardowns.push(cleanup);
	}

	/** React to a {@link TSharedCell} for this element's lifetime: THE one way a component tracks shared reactive
	 * state RELIABLY regardless of which bundle it lives in. A SignalWatcher's auto-tracking does not cross an esbuild
	 * IIFE boundary, so an external view (a separately-bundled viewer) would silently never re-render on a `get()` read;
	 * the cell's subscribers this adds to does cross it. Auto-torn-down on disconnect. Default handler re-renders. */
	protected watchSignal<V>(signal: TSharedCell<V>, handler: (value: V) => void = () => this.requestUpdate()): void {
		this.autoTeardown(signal.subscribe(handler));
	}

	/** Whether this component should show its toolbar/controls. Set via data-show-controls attribute. */
	protected get showControls(): boolean {
		return this.hasAttribute("data-show-controls");
	}

	/** Force a re-render. Most callers should not need this, mutate state via `setState` instead. Kept as an explicit escape hatch for callers that need to refresh after side-channel state change. */
	refresh(): void {
		this.requestUpdate();
	}

	/** Returns when a record of `label` was made, as its type's creation or published field states it. */
	protected extractTimestamp(vertex: Record<string, unknown>, label: string): number | null {
		const rels = getRels(label);
		return rels === undefined ? null : recordTime(vertex, rels);
	}

	/** Wrap a view's hypermedia products as a W3C `<script type="application/ld+json">` block. Used when a view wants to embed its structured payload for the chat-context harvester / a downstream agent following `_links`. */
	protected emitHypermediaScript(products: unknown): string {
		if (products == null) throw new Error(`<${this.localName}>.emitHypermediaScript called with ${products === null ? "null" : "undefined"} products`);
		return `<script type="application/ld+json">${JSON.stringify(products).replaceAll("</", "<\\/")}</script>`;
	}

	/** Subscribe to inbound events via the installed `TEventStream`, batching all events received between paints into one `onBatch(events)` call inside an animation frame. Delegates to the shared `subscribeBatchedEvents` (the data controllers use the same path). */
	protected subscribeBatched(opts: { onBatch: (events: TEvent[]) => void; filter?: TEventFilter; onReconnect?: () => void }): () => void {
		return subscribeBatchedEvents(opts);
	}
}

/** Longest a single value runs in a state-write description before it is cut, enough to recognize, short of a whole graph. */
const DESCRIBE_VALUE_MAX = 60;

/** The write a setState was asked to make, as `{field: value, …}`: the field names alone leave "received undefined"
 *  ambiguous between "the caller passed undefined" and "the caller omitted a field the merge needed". */
function describeStateWrite(partial: object): string {
	const fields = Object.entries(partial).map(([field, value]) => {
		let shown: string;
		try {
			shown = value === undefined ? "undefined" : JSON.stringify(value);
		} catch {
			shown = String(value); // a value JSON cannot take (a cycle, a DOM node) still has to name itself
		}
		return `${field}: ${shown.length > DESCRIBE_VALUE_MAX ? `${shown.slice(0, DESCRIBE_VALUE_MAX - 1)}…` : shown}`;
	});
	return `{ ${fields.join(", ")} }`;
}

/** Coerce an HTML attribute string into the value its state field's Zod type expects: presence-based boolean,
 * numeric parse, else the raw string. A removed attribute (null) yields undefined so setState applies the schema default. */
function coerceAttribute(fieldSchema: z.ZodTypeAny, val: string): unknown {
	const { inner } = unwrapWrappers(fieldSchema);
	if (inner instanceof z.ZodBoolean) return val !== "false";
	if (inner instanceof z.ZodNumber) return Number(val);
	return val;
}

/** Serialize a state value onto its bound attribute: the inverse of coerceAttribute, so the attribute reads as the value
 * written. A boolean at its initial state removes the attribute, which reads as that state; otherwise it is present for
 * true and "false" for false. An initially false boolean stays presence-based for CSS, and an initially true boolean
 * set false holds "false". An undefined, null or empty value removes the attribute, so the attribute doesn't hold a value
 * the state doesn't hold; anything else writes its string form. An attribute that already holds the value is not written
 * again, since a write reports a change. */
function reflectAttributeValue(el: HTMLElement, attr: string, fieldSchema: z.ZodTypeAny | undefined, value: unknown, initial: unknown): void {
	const serialized = attributeValueOf(fieldSchema, value, initial);
	if (el.getAttribute(attr) === serialized) return;
	if (serialized === null) el.removeAttribute(attr);
	else el.setAttribute(attr, serialized);
}

/** The attribute value a state value serializes to, or null where the attribute is absent. */
function attributeValueOf(fieldSchema: z.ZodTypeAny | undefined, value: unknown, initial: unknown): string | null {
	const inner = fieldSchema ? unwrapWrappers(fieldSchema).inner : undefined;
	if (fieldSchema && inner instanceof z.ZodBoolean) {
		if (value === initial) return null;
		return value === true ? "" : "false";
	}
	return value === undefined || value === null || value === "" ? null : String(value);
}

/** Re-export so components import the time-sync class names from the same module as ShuElement. */
