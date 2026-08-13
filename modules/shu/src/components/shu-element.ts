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
 * Time-sync (the `timeCursor` signal) and active-view (the `activePane` signal) are wired by #installTimeSync /
 * #installActiveView; subclasses override `onTimeSync(cursor)` / `onViewActive(active)` for custom behavior. Default
 * time-sync calls `requestUpdate` so views refresh as the cursor moves.
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

import { errorDetail } from "@haibun/core/lib/util/index.js";
import { LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { z } from "zod";
import { SHU_EVENT } from "../consts.js";
import { TIME_SYNC_CLASS } from "../time-sync.js";
import { timeCursor, activePane, type SharedSignal } from "../signals.js";
import { parseTimestampValue, type TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { unwrap as unwrapWrappers } from "@haibun/core/lib/zod-unwrap.js";
// Re-exported so every view can annotate its summarizeForKihan as `TLinkedData | null` from the same import it already
// takes for ShuElement, instead of each reaching into core for the node-object type.
export type { TLinkedData };
import { getRels } from "../rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import * as ViewHash from "../view-hash.js";
import { subscribeBatchedEvents, type TEvent, type TEventFilter } from "../event-stream.js";
import { readElementPrefs, schedulePersistWrite, forgetElementPrefs } from "../element-prefs.js";
import { recordClientBlip } from "../client-blips.js";

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

	/** State fields remembered across reloads — THE mechanism for any persisted UI option, declared like
	 * `attributeFields` and wired by the base: `setState` write-through-persists them (debounced, via
	 * element-prefs) and the sealed connect path restores them before `onConnected`. A field set explicitly
	 * via setState earlier in this element's lifetime (e.g. a URL-hash flag applied before attach) is never
	 * overwritten by the remembered value. Do not hand-roll component cookies — declare the field here. */
	static persistFields: readonly string[] = [];

	/** Identity under which `persistFields` store: "" (default) is a per-tag singleton; a multi-instance
	 * component overrides this with its instance identity (e.g. a column key); null means "no identity yet,
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
	#persistRestored = false;
	#restoring = false;
	#reflectingToAttr = false; // set while writing a state value back onto its bound attribute, so the resulting attributeChangedCallback doesn't reflect it straight back

	/**
	 * Current time cursor (absolute epoch ms; null = show all). ONE cursor system, two sources: live
	 * views read the shared global `timeCursor` SharedSignal (scrubbing one view syncs them all); snapshot-pinned
	 * views replay the frozen instant carried by `data-snapshot-time` (set by shu-product-view when a view
	 * is opened "as of" a point in history). The attribute is the single store for a pinned time — it is
	 * declarative, serializable, and already the marker other views check — so there is no parallel field.
	 * Reading this during an update auto-subscribes an in-bundle component via SignalWatcher; cross-bundle views
	 * react through `watchSignal(timeCursor, …)` (wired here by #installTimeSync for any onTimeSync overrider).
	 * Setting it publishes app-wide for a live view; a pinned view is frozen, so set is a no-op.
	 */
	protected get timeCursor(): number | null {
		if (this.hasAttribute("data-snapshot-time")) {
			const pinned = Number.parseFloat(this.getAttribute("data-snapshot-time") ?? "");
			return Number.isNaN(pinned) ? null : pinned;
		}
		return timeCursor.get();
	}
	protected set timeCursor(v: number | null) {
		if (this.hasAttribute("data-snapshot-time")) return; // a pinned view replays a fixed point and never moves the global cursor
		timeCursor.set(v); // SharedSignal.set co-fires the signal + the cross-bundle bus and no-ops an unchanged value
	}

	/** Record one fine-grained occurrence of this view's behaviour, at whatever rate it happens: held in the page's
	 *  fixed ring and handed to the run in batches, which retains none of it. The view attribution is this element's
	 *  hosting column (or the element itself when unhosted), so any control emits with one call and no plumbing of its
	 *  own. The name must be declared in `view-blips.ts`, where the vocabulary lives. */
	protected recordBlip(name: string, value?: number, attributes?: Record<string, unknown>): void {
		const root = this.getRootNode();
		const view = root instanceof ShadowRoot ? root.host.localName : this.localName;
		recordClientBlip(name, value, { view, ...attributes });
	}

	/** Whether this view is the strip's active pane: its containing column-pane's key equals the global `activePane`
	 *  signal. Derived, never stored — the signal is the one source of truth (reading it here auto-subscribes an in-bundle
	 *  render; a cross-bundle view reacts via #installActiveView). */
	protected get isActiveView(): boolean {
		const pane = this.closest("shu-column-pane") as HTMLElement | null;
		const key = pane?.dataset.columnKey ?? pane?.getAttribute("column-type") ?? null;
		return key !== null && key === activePane.get();
	}

	// Input type, not output: fields with a Zod `.default()` may be omitted (parse fills them), so a subclass whose
	// schema is all-defaulted can pass `{}`.
	constructor(schema: T, defaults: z.input<T>) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults);
		// Fail fast on a typo'd persistFields entry — a name absent from the schema would otherwise silently never persist.
		const persisted = (this.constructor as typeof ShuElement).persistFields;
		if (persisted.length > 0) {
			const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
			for (const f of persisted) if (!shape?.[f]) throw new Error(`${this.constructor.name}: persistFields names "${f}", which is absent from the schema`);
		}
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
		try {
			this.state = this._schema.parse({ ...(this.state as object), ...partial });
		} catch (error) {
			// A raw ZodError names the field and nothing else — not which element, which write, or what value. setState is
			// re-entrant (state → attribute → attributeChangedCallback → setState), so the stack alone does not say either.
			throw new Error(`<${this.tagName.toLowerCase()}> setState ${describeStateWrite(partial)}: ${error instanceof z.ZodError ? z.prettifyError(error) : String(error)}`, {
				cause: error,
			});
		}
		if (!this.#restoring) {
			for (const k of Object.keys(partial)) this.#dirtyFields.add(k);
			this.#persistChanged(Object.keys(partial));
		}
		// Reflect any changed attributeFields back onto their attributes (inverse of #reflectAttribute) — including during
		// a restore — so a bound attribute a subclass declared (e.g. a pane's `pinned`) stays in sync without per-caller code.
		this.#reflectFieldsToAttributes(Object.keys(partial));
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STATE_CHANGE, { detail: this.state, bubbles: true, composed: true }));
	}

	/**
	 * The options this element would carry across a reload, as a scene records them: exactly its `persistFields`, read
	 * off the live state. A saved view is therefore the same set of choices the element already treats as durable: there
	 * is no second list to keep in step with this one.
	 */
	captureSceneState(): Record<string, unknown> {
		const state = this.state as Record<string, unknown>;
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

	/** Forget this instance's remembered `persistFields`. For a view being DISMISSED, not merely removed: its options
	 *  describe the view the reader closed, so the next instance under the same identity opens with the defaults. A view
	 *  that is removed and expected back (a prune, a reload) must not call this — that is what the memory is for. */
	protected forgetPersisted(): void {
		const key = this.persistKey;
		if (key === null) return;
		forgetElementPrefs(this.tagName.toLowerCase(), key);
	}

	/** Write-through for persistFields touched by a setState. Debounced in element-prefs; values are collected at flush time so the latest state wins. */
	#persistChanged(changed: string[]): void {
		const fields = (this.constructor as typeof ShuElement).persistFields;
		if (fields.length === 0 || !changed.some((k) => fields.includes(k))) return;
		const key = this.persistKey;
		if (key === null) return;
		schedulePersistWrite(this.tagName.toLowerCase(), key, () => {
			const state = this.state as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const f of fields) if (state[f] !== undefined) out[f] = state[f];
			return out;
		});
	}

	/** Restore persisted fields on first connect (persistKey is settled by then — e.g. a pane's columnKey is
	 * assigned before attach). Fields the element already set explicitly stay; a stale or invalid remembered
	 * value is dropped by schema validation rather than crashing the boot. */
	#restorePersisted(): void {
		const fields = (this.constructor as typeof ShuElement).persistFields;
		if (this.#persistRestored || fields.length === 0) return;
		this.#persistRestored = true;
		const key = this.persistKey;
		if (key === null) return;
		const saved = readElementPrefs(this.tagName.toLowerCase(), key);
		if (!saved) return;
		const patch: Record<string, unknown> = {};
		for (const f of fields) if (f in saved && !this.#dirtyFields.has(f)) patch[f] = saved[f];
		if (Object.keys(patch).length === 0) return;
		const merged = this._schema.safeParse({ ...(this.state as object), ...patch });
		if (!merged.success) return;
		this.#restoring = true;
		try {
			this.setState(patch as Partial<z.infer<T>>);
		} finally {
			this.#restoring = false;
		}
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
		this.#restorePersisted();
		this.#installTimeSync();
		this.#installActiveView();
		this.onConnected();
	}

	disconnectedCallback(): void {
		this.onDisconnected();
		for (const teardown of this.#teardowns.splice(0)) teardown();
		super.disconnectedCallback();
	}

	attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
		super.attributeChangedCallback(name, oldValue, newValue);
		if (!this.#reflectingToAttr) this.#reflectAttribute(name, newValue); // skip the echo of our own state→attribute write
		this.onAttributeChanged(name, oldValue, newValue);
	}

	/** Reflect a bound attribute (declared in static attributeFields) into state via the schema; setState validates (fail-fast). */
	#reflectAttribute(name: string, val: string | null): void {
		const field = (this.constructor as typeof ShuElement).attributeFields[name];
		if (!field) return;
		const shape = (this._schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
		const fieldSchema = shape[field];
		if (!fieldSchema) throw new Error(`${this.constructor.name}: attributeFields maps "${name}" → state field "${field}", which is absent from the schema`);
		const coerced = coerceAttribute(fieldSchema, val);
		// An attribute that is NOT THERE says nothing about a field that must have a value; it does not blank it. The
		// inverse write removes an attribute whose value is empty, and reading that removal back as "no value" would
		// reject state the element legitimately holds. That is the loop a boot-time attribute write once fell into.
		if (coerced === undefined && !fieldSchema.safeParse(undefined).success) return;
		try {
			this.setState({ [field]: coerced } as Partial<z.infer<T>>);
		} catch (error) {
			// Name the attribute that drove the write: setState reports the state it rejected, not where that state came from.
			throw new Error(`<${this.tagName.toLowerCase()}> attribute ${name}=${JSON.stringify(val)} → state.${field}: ${errorDetail(error)}`, {
				cause: error,
			});
		}
	}

	/** Reflect every changed attributeField state value back onto its bound attribute (inverse of #reflectAttribute), guarded
	 *  so the resulting attributeChangedCallback doesn't echo it back into state. Fields with no bound attribute are ignored. */
	#reflectFieldsToAttributes(changed: string[]): void {
		const attributeFields = (this.constructor as typeof ShuElement).attributeFields;
		const bound = Object.entries(attributeFields).filter(([, field]) => changed.includes(field));
		if (bound.length === 0) return;
		const shape = (this._schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
		this.#reflectingToAttr = true;
		try {
			for (const [attr, field] of bound) reflectAttributeValue(this, attr, shape[field], (this.state as Record<string, unknown>)[field]);
		} finally {
			this.#reflectingToAttr = false;
		}
	}

	// One wiring for every cursor-watching component, in any bundle: the cross-bundle cursor bus runs onTimeSync on each
	// change. The bus (a globalThis subscriber set), not signal tracking — the polyfill's reactive context is module-level
	// and does not cross esbuild bundle boundaries, so an external view (the separately-bundled fisheye) reacts through
	// this same interface instead of hand-rolling its own subscribe. Views that only dim auto-rerender by reading
	// this.timeCursor in render(); snapshot-pinned views replay a fixed point and opt out.
	#installTimeSync(): void {
		const reactsToTime = this.onTimeSync !== ShuElement.prototype.onTimeSync;
		if (reactsToTime && !this.hasAttribute("data-snapshot-time")) {
			this.watchSignal(timeCursor, (cursor) => this.onTimeSync(cursor));
		}
	}

	// Sibling of #installTimeSync for the active-pane signal: a view that overrides onViewActive reacts across bundles
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

	/** Lit's render contract — return a TemplateResult. */
	abstract render(): TemplateResult;

	/**
	 * What this view presents, summarized for a Kihan as linked data: a JSON-LD node (`@id`, `@type`, and the
	 * view's content or a faithful digest of it). Called ON DEMAND by the chat-context harvester when the person
	 * asks — never on render — so a large summary costs nothing until it is actually sent. A view on screen the
	 * model cannot read is a broken ask; return null only for a pure control that presents no data (a picker, a
	 * button strip) — the decision is required of every view, never implicit.
	 */
	abstract summarizeForKihan(): TLinkedData | null;

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

	/** React to a {@link SharedSignal} for this element's lifetime — THE one way a component tracks shared reactive
	 * state RELIABLY regardless of which bundle it lives in. A SignalWatcher's auto-tracking does not cross an esbuild
	 * IIFE boundary, so an external view (a separately-bundled viewer) would silently never re-render on a `get()` read;
	 * the SharedSignal bus this subscribes does cross it. Auto-torn-down on disconnect. Default handler re-renders. */
	protected watchSignal<V>(signal: SharedSignal<V>, handler: (value: V) => void = () => this.requestUpdate()): void {
		this.autoTeardown(signal.subscribe(handler));
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
					if (rel === LinkRelations.GENERATED_AT_TIME.rel) return parseTimestampValue(vertex[field]);
				}
				for (const [field, rel] of Object.entries(rels)) {
					if (rel === LinkRelations.PUBLISHED.rel) return parseTimestampValue(vertex[field]);
				}
			}
		}
		for (const key of ["generatedAtTime", "validFrom", "dateCreated"]) {
			const val = parseTimestampValue(vertex[key]);
			if (val !== null) return val;
		}
		return null;
	}

	/** Wrap a view's hypermedia products as a W3C `<script type="application/ld+json">` block. Used when a view wants to embed its structured payload for the chat-context harvester / a downstream agent following `_links`. */
	protected emitHypermediaScript(products: unknown): string {
		if (products == null) throw new Error(`${this.constructor.name}.emitHypermediaScript called with ${products === null ? "null" : "undefined"} products`);
		return `<script type="application/ld+json">${JSON.stringify(products).replaceAll("</", "<\\/")}</script>`;
	}

	/** Subscribe to inbound events via the installed `EventStream`, batching all events received between paints into one `onBatch(events)` call inside an animation frame. Delegates to the shared `subscribeBatchedEvents` (the data controllers use the same path). */
	protected subscribeBatched(opts: { onBatch: (events: TEvent[]) => void; filter?: TEventFilter }): () => void {
		return subscribeBatchedEvents(opts);
	}
}

/** Longest a single value runs in a state-write description before it is cut — enough to recognize, short of a whole graph. */
const DESCRIBE_VALUE_MAX = 60;

/** The write a setState was asked to make, as `{field: value, …}` — the field names alone leave "received undefined"
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
function coerceAttribute(fieldSchema: z.ZodTypeAny, val: string | null): unknown {
	// A removed attribute (null) yields undefined so setState falls back to the field's schema default — this is
	// what makes a default-true boolean (e.g. `closable`) reset to true when absent, not to presence-semantics false.
	if (val === null) return undefined;
	const { inner } = unwrapWrappers(fieldSchema);
	if (inner instanceof z.ZodBoolean) return val !== "false";
	if (inner instanceof z.ZodNumber) return Number(val);
	return val;
}

/** Serialize a state value onto its bound attribute — the inverse of coerceAttribute. A boolean is presence-based (true =
 * present, false = absent), matching coerceAttribute's presence read; an undefined/null/empty value removes the attribute
 * so it never lingers stale; anything else writes its string form. */
function reflectAttributeValue(el: HTMLElement, attr: string, fieldSchema: z.ZodTypeAny | undefined, value: unknown): void {
	const inner = fieldSchema ? unwrapWrappers(fieldSchema).inner : undefined;
	if (inner instanceof z.ZodBoolean) el.toggleAttribute(attr, value === true);
	else if (value === undefined || value === null || value === "") el.removeAttribute(attr);
	else el.setAttribute(attr, String(value));
}

/** Re-export so components import the time-sync class names from the same module as ShuElement. */
export { TIME_SYNC_CLASS };
