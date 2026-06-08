/**
 * `ShuElement<T>` — base for every Shu web component. Extends `LitElement`
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
 * and skipping work on unchanged subtrees. No component writes to
 * `innerHTML` directly.
 *
 * `setState(partial)` validates the merged state against the schema and
 * assigns it to the reactive `state` property — Lit batches the re-render
 * into the next microtask. State mutations are whole-object replacements
 * so Lit's change detection (===) fires correctly.
 *
 * Time-sync (`SHU_EVENT.TIME_SYNC`) and active-view (`SHU_EVENT.VIEW_ACTIVE`)
 * are wired in the constructor; subclasses override `onTimeSync(cursor)` /
 * `onViewActive(active)` for custom behavior. Default time-sync calls
 * `requestUpdate` so views refresh as the cursor moves.
 *
 * Inbound event subscriptions go through `subscribeBatched({onBatch, filter})`
 * which coalesces every event arriving between paints into one handler call
 * inside an animation frame. The transport is the installed `EventStream`
 * (`event-stream.ts`); subscribers never construct `SseClient` or
 * `EventSource` directly.
 *
 * Light DOM: components that must live in the host's light DOM (e.g.
 * embedded 3D scenes whose `document.querySelector` lookups need to
 * resolve their children) override `createRenderRoot()` to return `this`.
 */

import { LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { z } from "zod";
import { SHU_EVENT } from "../consts.js";
import { TIME_SYNC_CLASS } from "../time-sync.js";
import { timeCursorSignal } from "../signals.js";
import { getRels } from "../rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import * as ViewHash from "../view-hash.js";
import { eventStream, type TEvent, type TEventFilter } from "../event-stream.js";

export abstract class ShuElement<T extends z.ZodType> extends SignalWatcher(LitElement) {
	/** Get the current view hash — from URL when a live `window.location` is present, from stored state when running in an offline standalone HTML file. */
	static getHash(): string {
		return ViewHash.getHash();
	}

	/** Update view hash. Online: writes to URL. Offline: updates stored state only. */
	static pushHash(newHash: string): void {
		ViewHash.pushHash(newHash);
	}

	/** Extra HTML attributes a subclass wants observed, beyond lit's reactive-property attributes. Declare this static array instead of overriding `observedAttributes` directly: lit computes `elementStyles` lazily inside its `observedAttributes` getter, so a raw override that skips `super` never triggers `finalize()` and the component silently inherits the base's empty styles — every `static styles` rule is dropped from the shadow root. */
	static observedHtmlAttributes: string[] = [];

	/** Map of observed HTML attribute → state field. The base reflects each into `state` through the Zod schema:
	 * coerced by the field's type (string / boolean-by-presence / number / enum), validated by setState — an invalid
	 * value throws, it never silently defaults. Declare this instead of a hand-written attributeChangedCallback
	 * if-chain. The attribute stays the source of truth; state mirrors it one-way (no reflect → no loops; CSS
	 * `:host([attr])` keeps working). Use onAttributeChanged only for side effects beyond state (e.g. syncing a child DOM node). */
	static attributeFields: Record<string, string> = {};

	static get observedAttributes(): string[] {
		return [...super.observedAttributes, ...Object.keys(this.attributeFields), ...this.observedHtmlAttributes];
	}

	/** Reactive state. Subclasses read via `this.state`; mutations go through `setState`. The Zod schema is the runtime contract. */
	@property({ attribute: false })
	accessor state!: z.infer<T>;

	private readonly _schema: T;
	#teardowns: Array<() => void> = [];

	/**
	 * Current time cursor (absolute epoch ms; null = show all). ONE cursor system, two sources: live
	 * views read the shared global `timeCursorSignal` (scrubbing one view syncs them all); snapshot-pinned
	 * views replay the frozen instant carried by `data-snapshot-time` (set by shu-product-view when a view
	 * is opened "as of" a point in history). The attribute is the single store for a pinned time — it is
	 * declarative, serializable, and already the marker other views check — so there is no parallel field.
	 * Reading this during an update auto-subscribes the component to cursor changes via SignalWatcher.
	 * Setting it publishes app-wide for a live view; a pinned view is frozen, so set is a no-op.
	 */
	protected get timeCursor(): number | null {
		if (this.hasAttribute("data-snapshot-time")) {
			const pinned = Number.parseFloat(this.getAttribute("data-snapshot-time") ?? "");
			return Number.isNaN(pinned) ? null : pinned;
		}
		return timeCursorSignal.get();
	}
	protected set timeCursor(v: number | null) {
		if (!this.hasAttribute("data-snapshot-time")) timeCursorSignal.set(v);
	}

	/** Whether this view is the strip's active pane child. Updated via VIEW_ACTIVE events fanned out by shu-column-pane.setActive. */
	protected isActiveView = false;

	constructor(schema: T, defaults: z.infer<T>) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults);
		this.addEventListener(
			SHU_EVENT.VIEW_ACTIVE as string,
			((e: CustomEvent) => {
				this.isActiveView = !!e.detail?.active;
				this.onViewActive(this.isActiveView);
			}) as EventListener,
		);
		this.#assertSealedLifecycle();
	}

	// Fail fast: a subclass that overrides a sealed lifecycle method (instead of the onX hook) would silently
	// bypass the base's super-call chain (SignalWatcher cleanup, lit attribute reflection). Throw at construction.
	#assertSealedLifecycle(): void {
		const proto = ShuElement.prototype as unknown as Record<string, unknown>;
		const self = this as unknown as Record<string, unknown>;
		for (const m of ["connectedCallback", "disconnectedCallback", "attributeChangedCallback"] as const) {
			if (self[m] !== proto[m]) {
				const hook = m === "connectedCallback" ? "onConnected" : m === "disconnectedCallback" ? "onDisconnected" : "onAttributeChanged";
				throw new Error(`${this.constructor.name} overrides sealed ShuElement.${m}() — override protected ${hook}() instead.`);
			}
		}
	}

	get schema(): T {
		return this._schema;
	}

	/** Shallow-merge a partial into state, validate against the schema, and assign it. The `@property accessor state` setter schedules the re-render off the new (Zod-parsed) reference; this also emits `SHU_EVENT.STATE_CHANGE` so external listeners (e.g. test harnesses) observe transitions. Throws if the merged shape fails schema validation — by contract a caller error. Merge is shallow by design (state is treated as a whole-object replacement so `===` change detection fires); pass the full sub-object to update a nested field. */
	protected setState(partial: Partial<z.infer<T>>): void {
		this.state = this._schema.parse({ ...(this.state as object), ...partial });
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STATE_CHANGE, { detail: this.state, bubbles: true, composed: true }));
	}

	protected validate(data: unknown): z.infer<T> {
		return this._schema.parse(data);
	}

	protected safeValidate(data: unknown): { success: boolean; data?: z.infer<T>; error?: z.ZodError } {
		const result = this._schema.safeParse(data);
		return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
	}

	// SEALED — do not override in a subclass. Override the protected onConnected/onDisconnected/onAttributeChanged
	// hooks instead; the base owns the super-call chain so SignalWatcher cleanup and lit attribute reflection
	// can never be silently skipped. A subclass that overrides any of these throws at construction (see #assertSealed).
	connectedCallback(): void {
		super.connectedCallback();
		this.#installTimeSyncEffect();
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
		this.onAttributeChanged(name, oldValue, newValue);
	}

	/** Reflect a bound attribute (declared in static attributeFields) into state via the schema; setState validates (fail-fast). */
	#reflectAttribute(name: string, val: string | null): void {
		const field = (this.constructor as typeof ShuElement).attributeFields[name];
		if (!field) return;
		const shape = (this._schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
		const fieldSchema = shape[field];
		if (!fieldSchema) throw new Error(`${this.constructor.name}: attributeFields maps "${name}" → state field "${field}", which is absent from the schema`);
		this.setState({ [field]: coerceAttribute(fieldSchema, val) } as Partial<z.infer<T>>);
	}

	// Views that dim purely in render() auto-subscribe by reading this.timeCursor there. Views that
	// override onTimeSync for post-render DOM work (row classes, legends) are driven by this effect:
	// it reads the live cursor signal and re-runs onTimeSync whenever it changes. Auto-disposed on
	// disconnect by SignalWatcher. Snapshot-pinned views replay a fixed point, so they opt out.
	#installTimeSyncEffect(): void {
		const reactsToTime = this.onTimeSync !== ShuElement.prototype.onTimeSync;
		if (reactsToTime && !this.hasAttribute("data-snapshot-time")) {
			let first = true;
			this.updateEffect(() => {
				const cursor = timeCursorSignal.get();
				if (first) {
					first = false;
					return;
				}
				this.onTimeSync(cursor);
			});
		}
	}

	/** Lit's render contract — return a TemplateResult. */
	abstract render(): TemplateResult;

	/** Called when TIME_SYNC is received. Default re-renders via `requestUpdate`; override for custom behavior. */
	protected onTimeSync(_cursor: number | null): void {
		this.requestUpdate();
	}

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
	 * down — so a component needs no onDisconnected body and can never leak a forgotten removeEventListener. */
	protected autoListen(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void {
		target.addEventListener(type, handler, opts);
		this.#teardowns.push(() => target.removeEventListener(type, handler, opts));
	}

	/** Register an arbitrary cleanup (a subscribe() unsub, ResizeObserver.disconnect, clearTimeout, …) to run on disconnect. */
	protected autoTeardown(cleanup: () => void): void {
		this.#teardowns.push(cleanup);
	}

	/** Whether this component should show its toolbar/controls. Set via data-show-controls attribute. */
	protected get showControls(): boolean {
		return this.hasAttribute("data-show-controls");
	}

	/** Force a re-render. Most callers should not need this — mutate state via `setState` instead. Kept as an explicit escape hatch for callers that need to refresh after side-channel state change. */
	refresh(): void {
		this.requestUpdate();
	}

	/** True iff the timestamp lies strictly after the current time cursor. When no cursor is set, nothing is in the future. */
	protected isFuture(timestamp: number): boolean {
		return this.timeCursor !== null && timestamp > this.timeCursor;
	}

	/** Filter an array of timestamped items, keeping only those at or before cursor. */
	protected filterByTime<I extends { timestamp: number }>(items: I[]): I[] {
		const cursor = this.timeCursor;
		if (cursor === null) return items;
		return items.filter((item) => item.timestamp <= cursor);
	}

	/** Extract creation timestamp from an individual using concern metadata. Prefers the uniform creation field (rel generatedAtTime), then the published field (LinkRelations.PUBLISHED), then common fallbacks. */
	protected extractTimestamp(vertex: Record<string, unknown>, label?: string): number | null {
		if (label) {
			const rels = getRels(label);
			if (rels) {
				for (const [field, rel] of Object.entries(rels)) {
					if (rel === LinkRelations.GENERATED_AT_TIME.rel) return parseTimestamp(vertex[field]);
				}
				for (const [field, rel] of Object.entries(rels)) {
					if (rel === LinkRelations.PUBLISHED.rel) return parseTimestamp(vertex[field]);
				}
			}
		}
		for (const key of ["generatedAtTime", "validFrom", "dateCreated"]) {
			const val = parseTimestamp(vertex[key]);
			if (val !== null) return val;
		}
		return null;
	}

	/** Wrap a view's hypermedia products as a W3C `<script type="application/ld+json">` block. Used when a view wants to embed its structured payload for the chat-context harvester / a downstream agent following `_links`. */
	protected emitHypermediaScript(products: unknown): string {
		if (products == null) throw new Error(`${this.constructor.name}.emitHypermediaScript called with ${products === null ? "null" : "undefined"} products`);
		return `<script type="application/ld+json">${JSON.stringify(products).replaceAll("</", "<\\/")}</script>`;
	}

	/** Subscribe to inbound events via the installed `EventStream`, batching all events received between paints into one `onBatch(events)` call inside an animation frame. */
	protected subscribeBatched(opts: { onBatch: (events: TEvent[]) => void; filter?: TEventFilter }): () => void {
		let pending: TEvent[] = [];
		let scheduled = false;
		let active = true;
		const drain = () => {
			scheduled = false;
			if (!active || pending.length === 0) return;
			const batch = pending;
			pending = [];
			opts.onBatch(batch);
		};
		const innerUnsub = eventStream().subscribe((event) => {
			if (!active) return;
			pending.push(event);
			if (!scheduled) {
				scheduled = true;
				requestAnimationFrame(drain);
			}
		}, opts.filter);
		return () => {
			active = false;
			pending = [];
			innerUnsub();
		};
	}
}

function parseTimestamp(val: unknown): number | null {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const d = new Date(val);
		if (!Number.isNaN(d.getTime())) return d.getTime();
	}
	return null;
}

/** Unwrap ZodDefault/Optional/Nullable wrappers to the inner type. */
function peelSchema(t: z.ZodTypeAny): z.ZodTypeAny {
	let s = t;
	for (;;) {
		const inner = (s as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def?.innerType;
		if (!inner) return s;
		s = inner;
	}
}

/** Coerce an HTML attribute string into the value its state field's Zod type expects: presence-based boolean,
 * numeric parse, else the raw string. A removed attribute (null) yields undefined so setState applies the schema default. */
function coerceAttribute(fieldSchema: z.ZodTypeAny, val: string | null): unknown {
	// A removed attribute (null) yields undefined so setState falls back to the field's schema default — this is
	// what makes a default-true boolean (e.g. `closable`) reset to true when absent, not to presence-semantics false.
	if (val === null) return undefined;
	const inner = peelSchema(fieldSchema);
	if (inner instanceof z.ZodBoolean) return val !== "false";
	if (inner instanceof z.ZodNumber) return Number(val);
	return val;
}

/** Re-export so components import the time-sync class names from the same module as ShuElement. */
export { TIME_SYNC_CLASS };
