import { z } from "zod";
import { SHU_EVENT } from "../consts.js";
import { TIME_SYNC_CLASS, TIME_SYNC_CSS, TIME_SYNC_STYLE } from "../time-sync.js";
import { getRels } from "../rels-cache.js";

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
	static offline = false;

	private static _storedHash = "";

	/** Get the current view hash — from URL when online, from stored state when offline. */
	static getHash(): string {
		return ShuElement.offline ? ShuElement._storedHash : location.hash;
	}

	/** Update view hash. Online: writes to URL. Offline: updates stored state only. */
	static pushHash(newHash: string): void {
		ShuElement._storedHash = newHash;
		if (ShuElement.offline) return;
		try {
			if (location.hash !== newHash) history.replaceState(null, "", newHash);
		} catch { /* file:// security restriction */ }
	}

	protected state: z.infer<T>;
	private _schema: T;

	/** Current time cursor (absolute epoch ms). null = show all (no time filter). */
	protected timeCursor: number | null = null;

	constructor(schema: T, defaults: z.infer<T>) {
		super();
		this._schema = schema;
		this.state = schema.parse(defaults);
		this.attachShadow({ mode: "open" });
		this.addEventListener(
			SHU_EVENT.TIME_SYNC as string,
			((e: CustomEvent) => {
				this.timeCursor = e.detail?.currentTime ?? null;
				this.onTimeSync(this.timeCursor);
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
		this.render();
	}

	protected abstract render(): void;

	/** Called when TIME_SYNC is received. Override for custom behavior. Default: re-render. */
	protected onTimeSync(_cursor: number | null): void {
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
					if (rel === "published") return parseTimestamp(vertex[field]);
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
