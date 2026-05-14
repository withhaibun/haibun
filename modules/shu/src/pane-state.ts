/**
 * Single source of truth for which panes are open.
 *
 * All pane-creation paths — URL-hash restoration, step invocation, toolbar, hash
 * navigation — call `request()` / `dismiss()`. The reconciler is the only thing
 * that creates or destroys panes, so duplicates can't enter the system.
 *
 *   URL hash         ──┐
 *   step invocation  ──┼──► request / dismiss ──► reconcile ──► strip + hash
 *   toolbar          ──┘
 *
 * Each `DesiredPane` carries only the variant's identifying data; the reconciler
 * derives the dedup id, the child tag, and the display label from the variant
 * via `paneIdOf` / `tagOf` / `labelOf`. No redundant fields, no drift.
 */
import { z } from "zod";
import * as ViewHash from "./view-hash.js";
import { SHU_ATTR, SHU_EVENT } from "./consts.js";
import { readShowControlsCookie } from "./show-controls.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";

const FlagSchema = z.enum(["min", "max"]).optional();
const TagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const DesiredPaneSchema = z.discriminatedUnion("paneType", [
	z.object({ paneType: z.literal("component"), tag: TagSchema, label: z.string(), data: z.record(z.string(), z.unknown()).optional(), flag: FlagSchema }),
	z.object({ paneType: z.literal("entity"), id: z.string(), vertexLabel: z.string(), label: z.string().optional(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-eq"), vertexLabel: z.string(), predicate: z.string(), value: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-prop"), vertexLabel: z.string(), predicate: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("filter-incoming"), vertexLabel: z.string(), subject: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("thread"), vertexLabel: z.string(), subject: z.string(), flag: FlagSchema }),
	z.object({ paneType: z.literal("step-detail"), seqPath: z.array(z.number()), flag: FlagSchema }),
	z.object({ paneType: z.literal("views-picker"), views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })), label: z.string(), flag: FlagSchema }),
]);

export type DesiredPane = z.infer<typeof DesiredPaneSchema>;
export type DesiredPaneType = DesiredPane["paneType"];

export function paneIdOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
			return d.tag;
		case "entity":
			return `e:${d.vertexLabel}:${d.id}`;
		case "filter-eq":
			return `f:${d.vertexLabel}:${d.predicate}=${d.value}`;
		case "filter-prop":
			return `p:${d.vertexLabel}:${d.predicate}`;
		case "filter-incoming":
			return `i:${d.vertexLabel}:${d.subject}`;
		case "thread":
			return `t:${d.vertexLabel}:${d.subject}`;
		case "step-detail":
			return `step:${d.seqPath.join(".")}`;
		case "views-picker":
			return "views";
	}
}

export function tagOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
			return d.tag;
		case "entity":
			return "shu-entity-column";
		case "filter-eq":
		case "filter-prop":
		case "filter-incoming":
			return "shu-filter-column";
		case "thread":
			return "shu-thread-column";
		case "step-detail":
			return "shu-step-detail";
		case "views-picker":
			return "shu-views-picker";
	}
}

export function labelOf(d: DesiredPane): string {
	switch (d.paneType) {
		case "component":
		case "views-picker":
			return d.label;
		case "entity":
			return d.label ?? d.id;
		case "filter-eq":
			return `${d.predicate}=${d.value}`;
		case "filter-prop":
			return d.predicate;
		case "filter-incoming":
			return `links to ${d.subject}`;
		case "thread":
			return `Replies: ${d.subject}`;
		case "step-detail":
			return `Step [${d.seqPath.join(".")}]`;
	}
}

/**
 * Per-paneType post-attach hook. Each parametric pane (entity, filter, ...) needs
 * to call `.open(...)` on its freshly-created child. Keyed by `paneType` so a new
 * variant means one schema entry + one hook — no central switch.
 *
 * `paneType: "component"` needs no hook (data flows via `data`). External component
 * loading also lives here so pane-state has no direct registry dependency.
 */
export type PaneHooks = {
	ensureLoaded?(tag: string): Promise<void> | void;
	afterAttach?: Partial<Record<DesiredPaneType, (d: DesiredPane, child: HTMLElement) => Promise<void> | void>>;
};

class PaneStateImpl {
	private desired = new Map<string, DesiredPane>();
	private strip: ShuColumnStrip | null = null;
	private hooks: PaneHooks = {};
	private activePaneId: string | null = null;

	init(strip: ShuColumnStrip, hooks: PaneHooks = {}): void {
		this.strip = strip;
		this.hooks = hooks;
		window.addEventListener("hashchange", () => this.fromHash());
		// User-initiated per-pane control toggles (minimize / maximize / expand) update
		// the canonical `desired.flag` so subsequent reconciles preserve the user's choice
		// and the URL hash stays in sync. Without this, any later `request()` would call
		// `applyFlag(existing, undefined)` and wipe the user's minimized / maximized state.
		strip.addEventListener(SHU_EVENT.COLUMN_MINIMIZE, ((e: CustomEvent) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset?.columnKey;
			if (!id) return;
			const minimized = Boolean(e.detail?.minimized);
			this.setFlag(id, minimized ? "min" : undefined);
		}) as EventListener);
		strip.addEventListener(SHU_EVENT.COLUMN_MAXIMIZE, ((e: CustomEvent) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset?.columnKey;
			if (!id) return;
			const maximized = Boolean(e.detail?.maximized);
			this.setFlag(id, maximized ? "max" : undefined);
		}) as EventListener);
		strip.addEventListener(SHU_EVENT.COLUMN_EXPAND, ((e: Event) => {
			const pane = e.target as HTMLElement;
			const id = pane.dataset?.columnKey;
			if (!id) return;
			this.setFlag(id, undefined);
		}) as EventListener);
	}

	/** Update the flag for a pane already in `desired`. No-op when the pane is unknown
	 * (e.g. the query pane, which lives outside PaneState's tracked set). Writes the
	 * URL hash so the user's choice survives a reload. */
	private setFlag(paneId: string, flag: DesiredPane["flag"]): void {
		const d = this.desired.get(paneId);
		if (!d) return;
		if (d.flag === flag) return;
		this.desired.set(paneId, { ...d, flag } as DesiredPane);
		this.writeHash();
	}

	/** Parse the URL hash into desired panes and reconcile. */
	fromHash(): void {
		const hash = ViewHash.getHash().replace(/^#\??/, "");
		const params = new URLSearchParams(hash);
		const active = params.get("active");
		const next = new Map<string, DesiredPane>();
		const idParam = params.get("id");
		const labelParam = params.get("label");
		const rawCols = params.getAll("col");
		if (idParam && labelParam && rawCols.length === 0) {
			const d = parseColEntry(`e:${labelParam}:${idParam}`);
			if (d) next.set(paneIdOf(d), d);
		}
		for (const raw of rawCols) {
			const d = parseColEntry(raw);
			if (d) next.set(paneIdOf(d), d);
		}
		this.activePaneId = active && next.has(active) ? active : firstKeyOf(next);
		this.desired = next;
		this.scheduleReconcile();
	}

	/** Add or update a pane. Validates against the schema; throws loudly on a bad input. */
	request(input: DesiredPane): void {
		const d = DesiredPaneSchema.parse(input);
		const id = paneIdOf(d);
		const existing = this.desired.get(id);
		// Re-request with fresh component data: hand it to the live child directly.
		if (existing && d.paneType === "component" && d.data) {
			const live = this.findLiveChild(id);
			if (live) (live as HTMLElement & { products?: Record<string, unknown> }).products = d.data;
		}
		this.desired.set(id, d);
		this.activePaneId = id;
		this.scheduleReconcile();
	}

	dismiss(paneId: string): void {
		if (!this.desired.delete(paneId)) return;
		if (this.activePaneId === paneId) this.activePaneId = firstKeyOf(this.desired);
		this.scheduleReconcile();
	}

	snapshot(): DesiredPane[] {
		return [...this.desired.values()];
	}

	has(paneId: string): boolean {
		return this.desired.has(paneId);
	}

	__resetForTests(): void {
		this.desired.clear();
		this.activePaneId = null;
		this.strip = null;
		this.hooks = {};
		this.reconcileInFlight = false;
		this.reconcileRequested = false;
	}

	private reconcileInFlight = false;
	private reconcileRequested = false;

	private scheduleReconcile(): void {
		this.reconcileRequested = true;
		if (this.reconcileInFlight) return;
		this.reconcileInFlight = true;
		queueMicrotask(async () => {
			while (this.reconcileRequested) {
				this.reconcileRequested = false;
				await this.reconcile();
			}
			this.reconcileInFlight = false;
		});
	}

	private async reconcile(): Promise<void> {
		if (!this.strip) return;
		const live = new Map<string, ShuColumnPane>();
		for (const p of this.strip.panes) {
			const id = p.dataset.columnKey ?? p.getAttribute(SHU_ATTR.COLUMN_TYPE);
			if (id && id !== "query") live.set(id, p);
		}
		// Route removals through `removePane` so the strip emits COLUMNS_CHANGED for each
		// dismissal. A bare `pane.remove()` mutates the DOM but the actions-bar breadcrumb
		// (which listens on COLUMNS_CHANGED) would never update.
		for (const [id, pane] of live) {
			if (this.desired.has(id)) continue;
			const idx = this.strip.panes.indexOf(pane);
			if (idx >= 0) this.strip.removePane(idx);
			else pane.remove();
		}
		for (const d of this.desired.values()) {
			const id = paneIdOf(d);
			const existing = live.get(id);
			if (existing) {
				existing.setAttribute("label", labelOf(d));
				applyFlag(existing, d.flag);
				continue;
			}
			await this.openPane(d, id);
		}
		this.writeHash();
		this.activate();
	}

	private async openPane(d: DesiredPane, id: string): Promise<void> {
		if (!this.strip) return;
		const tag = tagOf(d);
		await this.hooks.ensureLoaded?.(tag);
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", labelOf(d));
		pane.setAttribute(SHU_ATTR.COLUMN_TYPE, columnTypeFor(d));
		pane.setAttribute(SHU_ATTR.PINNED, "true");
		pane.dataset.columnKey = id;
		this.strip.addPane(pane);
		const child = document.createElement(tag);
		if (readShowControlsCookie(tag)) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		if (d.paneType === "component" && d.data) (child as HTMLElement & { products?: Record<string, unknown> }).products = d.data;
		pane.appendChild(child);
		applyFlag(pane, d.flag);
		await this.hooks.afterAttach?.[d.paneType]?.(d, child);
	}

	private writeHash(): void {
		const base = ViewHash.getHash();
		const params = new URLSearchParams(base.startsWith("#?") ? base.slice(2) : "");
		params.delete("col");
		for (const d of this.desired.values()) {
			const suffix = d.flag === "min" ? "~min" : d.flag === "max" ? "~max" : "";
			params.append("col", `${paneIdOf(d)}${suffix}`);
		}
		if (this.activePaneId) params.set("active", this.activePaneId);
		else params.delete("active");
		const next = `#?${params.toString()}`;
		if (next !== base) ViewHash.pushHash(next);
	}

	private activate(): void {
		if (!this.strip || !this.activePaneId) return;
		const idx = this.strip.panes.findIndex((p) => p.dataset.columnKey === this.activePaneId);
		if (idx >= 0) this.strip.activatePane(idx);
	}

	private findLiveChild(paneId: string): HTMLElement | undefined {
		const pane = this.strip?.panes.find((p) => p.dataset.columnKey === paneId);
		return pane?.children[0] as HTMLElement | undefined;
	}
}

function firstKeyOf(m: Map<string, DesiredPane>): string | null {
	const it = m.keys().next();
	return it.done ? null : it.value;
}

function columnTypeFor(d: DesiredPane): string {
	if (d.paneType === "component") return d.tag;
	if (d.paneType === "filter-eq" || d.paneType === "filter-prop" || d.paneType === "filter-incoming") return "filter";
	if (d.paneType === "step-detail") return "step";
	return d.paneType;
}

function applyFlag(pane: ShuColumnPane, flag: DesiredPane["flag"]): void {
	if (flag === "min") {
		pane.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
		pane.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
	} else if (flag === "max") {
		pane.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
		pane.removeAttribute(SHU_ATTR.DATA_MINIMIZED);
		pane.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { bubbles: true, composed: true }));
	} else {
		pane.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
		pane.removeAttribute(SHU_ATTR.DATA_MINIMIZED);
	}
}

/**
 * Parse one `col=` URL entry into a DesiredPane. Returns null for malformed
 * entries — `fromHash` skips nulls so a stale hash never crashes the boot.
 *
 * Each prefix maps to one paneType: `e:` entity, `f:` filter-eq, `p:` filter-prop,
 * `t:` thread, `step:` step-detail. Anything else is a component tag.
 */
export function parseColEntry(raw: string): DesiredPane | null {
	const flag: DesiredPane["flag"] = raw.endsWith("~max") ? "max" : raw.endsWith("~min") ? "min" : undefined;
	const body = flag ? raw.slice(0, -4) : raw;
	const colon = (s: string) => {
		const i = s.indexOf(":");
		return i < 0 ? null : [s.slice(0, i), s.slice(i + 1)] as const;
	};
	if (body.startsWith("e:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "entity", vertexLabel: split[0], id: split[1], flag });
	}
	if (body.startsWith("f:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		const eq = split[1].indexOf("=");
		if (eq < 0) return null;
		return safe({ paneType: "filter-eq", vertexLabel: split[0], predicate: split[1].slice(0, eq), value: split[1].slice(eq + 1), flag });
	}
	if (body.startsWith("p:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "filter-prop", vertexLabel: split[0], predicate: split[1], flag });
	}
	if (body.startsWith("i:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "filter-incoming", vertexLabel: split[0], subject: split[1], flag });
	}
	if (body.startsWith("t:")) {
		const split = colon(body.slice(2));
		if (!split) return null;
		return safe({ paneType: "thread", vertexLabel: split[0], subject: split[1], flag });
	}
	if (body.startsWith("step:")) {
		const seq = body.slice(5).split(".").map(Number);
		if (seq.some((n) => Number.isNaN(n))) return null;
		return safe({ paneType: "step-detail", seqPath: seq, flag });
	}
	return safe({ paneType: "component", tag: body, label: body, flag });
}

function safe(input: unknown): DesiredPane | null {
	const r = DesiredPaneSchema.safeParse(input);
	return r.success ? r.data : null;
}

export const PaneState = new PaneStateImpl();
