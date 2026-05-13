import { z } from "zod";
import { SHU_EVENT } from "../consts.js";
import { TIME_SYNC_CLASS, TIME_SYNC_CSS, TIME_SYNC_STYLE } from "../time-sync.js";
import { getRels } from "../rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import * as ViewHash from "../view-hash.js";
import { snapshotUiState, restoreUiState, type TUiStateSnapshot } from "./ui-state.js";
import { SseClient, type TEventFilter } from "../sse-client.js";

type TBatchEvent = Record<string, unknown>;

/**
 * Abstract base class for Shu web components.
 * Each subclass declares a Zod schema that serves as both the component's
 * state contract and a Haibun domain definition.
 *
 * Provides automatic TIME_SYNC handling — every component receives time sync events.
 * Subclasses override `onTimeSync()` for custom behavior; default triggers re-render.
 */
export abstract class ShuElement<T extends z.ZodType> extends HTMLElement {
	/** True when running offline from an exported HTML file. No server, no RPC, no SSE. Set once at startup. */
	static get offline(): boolean {
		return ViewHash.isOffline();
	}
	static set offline(v: boolean) {
		ViewHash.setOffline(v);
	}

	/** Get the current view hash — from URL when online, from stored state when offline. */
	static getHash(): string {
		return ViewHash.getHash();
	}

	/** Update view hash. Online: writes to URL. Offline: updates stored state only. */
	static pushHash(newHash: string): void {
		ViewHash.pushHash(newHash);
	}

	protected state: z.infer<T>;
	private _schema: T;

	/** Current time cursor (absolute epoch ms). null = show all (no time filter). */
	protected timeCursor: number | null = null;

	/** Whether this view is the strip's active pane child. Updated via VIEW_ACTIVE events fanned out by shu-column-pane.setActive. */
	protected isActiveView = false;

	constructor(schema: T, defaults: z.infer<T>, opts?: { lightDom?: boolean }) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults);
		// Most components encapsulate via shadow DOM, but e.g. a-frame-based viewers must live
		// in light DOM so AFRAME's `document.querySelector("#fisheye-rig")` lookups still
		// resolve. Light-DOM subclasses render into `this.innerHTML` directly.
		if (!opts?.lightDom) this.attachShadow({ mode: "open" });
		this.addEventListener(
			SHU_EVENT.TIME_SYNC as string,
			((e: CustomEvent) => {
				if (this.hasAttribute("data-snapshot-time")) return;
				this.timeCursor = e.detail?.currentTime ?? null;
				this.onTimeSync(this.timeCursor);
			}) as EventListener,
		);
		this.addEventListener(
			SHU_EVENT.VIEW_ACTIVE as string,
			((e: CustomEvent) => {
				this.isActiveView = !!e.detail?.active;
				this.onViewActive(this.isActiveView);
			}) as EventListener,
		);
	}

	get schema(): T {
		return this._schema;
	}

	protected setState(partial: Partial<z.infer<T>>): void {
		const next = this._schema.parse(Object.assign({}, this.state, partial));
		this.state = next;
		this.render();
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STATE_CHANGE, { detail: this.state, bubbles: true, composed: true }));
	}

	protected validate(data: unknown): z.infer<T> {
		return this._schema.parse(data);
	}

	protected safeValidate(data: unknown): { success: boolean; data?: z.infer<T>; error?: z.ZodError } {
		const result = this._schema.safeParse(data);
		if (result.success) return { success: true, data: result.data };
		return { success: false, error: result.error };
	}

	connectedCallback(): void {
		const snapshot = this.getAttribute("data-snapshot-time");
		if (snapshot) this.timeCursor = parseFloat(snapshot);
		this.render();
	}

	protected abstract render(): void;

	/** Called when TIME_SYNC is received. Override for custom behavior. Default: re-render. */
	protected onTimeSync(_cursor: number | null): void {
		this.render();
	}

	/** Called when this view's active state toggles (its containing pane became / stopped being the active pane). Default no-op; override for custom behavior. */
	protected onViewActive(_active: boolean): void {
		// no-op default; subclasses override.
	}

	/** Whether this component should show its toolbar/controls. Set via data-show-controls attribute. */
	protected get showControls(): boolean {
		return this.hasAttribute("data-show-controls");
	}

	/** Force a re-render. Used by parent components (e.g., column pane controls toggle). */
	refresh(): void {
		this.render();
	}

	/** Check if a timestamp is in the future of the current time cursor. */
	protected isFuture(timestamp: number): boolean {
		return this.timeCursor !== null && timestamp > this.timeCursor;
	}

	/** Filter an array of timestamped items, keeping only those at or before cursor. */
	protected filterByTime<I extends { timestamp: number }>(items: I[]): I[] {
		const cursor = this.timeCursor;
		if (cursor === null) return items;
		return items.filter((item) => item.timestamp <= cursor);
	}

	/**
	 * Extract creation timestamp from a vertex using concern metadata.
	 * Looks for the field with rel "published" (LinkRelations.PUBLISHED), then common fallbacks.
	 */
	protected extractTimestamp(vertex: Record<string, unknown>, label?: string): number | null {
		if (label) {
			const rels = getRels(label);
			if (rels) {
				for (const [field, rel] of Object.entries(rels)) {
					if (rel === LinkRelations.PUBLISHED.rel) return parseTimestamp(vertex[field]);
				}
			}
		}
		for (const key of ["validFrom", "dateCreated", "created", "timestamp"]) {
			const val = parseTimestamp(vertex[key]);
			if (val !== null) return val;
		}
		return null;
	}

	/** Wrap styles with TIME_SYNC_CSS automatically included. */
	protected css(styles: string): string {
		return `<style>${TIME_SYNC_CSS}\n${styles}</style>`;
	}

	/** Snapshot UI state that should survive a re-render. See `./ui-state.ts`. */
	protected snapshotUiState(): TUiStateSnapshot {
		return snapshotUiState(this);
	}

	/** Reapply the snapshot taken by `snapshotUiState()`. Safe to call after `innerHTML` rebuilds. */
	protected restoreUiState(snapshot: TUiStateSnapshot): void {
		restoreUiState(this, snapshot);
	}

	/**
	 * Subscribe to SSE events, batching all events received between paints into
	 * one `onBatch(events)` call inside an animation frame.
	 *
	 * Why this exists: `SseClient.onEvent` replays the entire history buffer
	 * synchronously when the subscriber registers. A fresh component mount that
	 * processes-and-renders per event blocks the main thread for N×handler-cost
	 * milliseconds before the page can paint. `subscribeBatched` queues raw
	 * events on the synchronous path (cheap push), drains them once per rAF
	 * tick, and runs the per-batch processor — typically a render — exactly
	 * once per frame. Replay then costs one render, not N.
	 *
	 * Returns an unsubscribe function. The caller wires it into
	 * `disconnectedCallback`; the queue is dropped on unsubscribe so a stray
	 * frame after disconnect can't reach into a torn-down component.
	 */
	protected subscribeBatched(opts: { onBatch: (events: TBatchEvent[]) => void; filter?: TEventFilter; basePath?: string }): () => void {
		const client = SseClient.for(opts.basePath ?? "");
		let pending: TBatchEvent[] = [];
		let scheduled = false;
		let active = true;
		const drain = () => {
			scheduled = false;
			if (!active || pending.length === 0) return;
			const batch = pending;
			pending = [];
			opts.onBatch(batch);
		};
		const innerUnsub = client.onEvent((event) => {
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

/** Re-export for components that need direct access to class names or style values. */
export { TIME_SYNC_CLASS, TIME_SYNC_STYLE };
