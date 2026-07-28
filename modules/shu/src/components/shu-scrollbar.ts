/**
 * <shu-scrollbar> — the custom vertical scroll rail for a virtualized column: a thumb sized to the viewport's share of the column, a
 * position glyph at each end (first visible row ordinal, total), and marker glyphs on the rail for significant rows
 * anywhere in the full data set (annotations, failed steps, feature boundaries) so a reader sees them across the whole
 * column and can jump to one even when it is far outside the rendered window. It is the only usable scroll affordance in
 * immersive WebXR (native scrollbars are not composited there) and can show position inside a fetched set of millions,
 * which a native scrollbar cannot. Geometry is the pure, tested scrollbar-model; this element is the DOM wiring.
 *
 * It drives nothing itself: it emits `scroll-to-index` and the column (which owns the virtualizer) scrolls. Input is
 * unified through Pointer Events so mouse, touch, and pen behave identically on every device.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { property } from "lit/decorators.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { shuBaseStyles } from "./styles.js";
import { thumbHeightPx, thumbTopPx, firstAtPointer, clusterMarkers, formatCount, type TScrollMarker, type TWindow } from "../scrollbar-model.js";

const EmptySchema = z.object({});

/** Emitted (bubbling, composed) with `{ index }` when the reader drags the thumb, clicks the rail, wheels, or clicks a
 *  marker: the column should scroll so `index` is the first visible row. */
export const SCROLL_TO_INDEX = "scroll-to-index";

export class ShuScrollbar extends ShuElement<typeof EmptySchema> {
	constructor() {
		super(EmptySchema, {});
	}

	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	@property({ attribute: false }) accessor total = 0;
	@property({ attribute: false }) accessor window: TWindow = { first: 0, visible: 0 };
	@property({ attribute: false }) accessor markers: TScrollMarker[] = [];
	/** The viewport's share of the column (0..1), measured by the host; unset falls back to the visible row share. */
	@property({ attribute: false }) accessor viewportFraction: number | undefined;
	/** Show the position glyphs (first-visible ordinal / total). A row-list column wants them; a rail over continuous prose,
	 *  where the numbers would read as raw pixels, sets this false and keeps only the marks and the thumb. */
	@property({ type: Boolean }) accessor showPosition = true;

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; align-items: center; width: var(--shu-scrollbar-w); flex-shrink: 0; user-select: none; touch-action: none; }
			.pos { font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-1) 0; line-height: 1; font-weight: 500; font-variant-numeric: tabular-nums; }
			.pos-bottom { margin-top: auto; }
			.rail { position: relative; flex: 1; width: 14px; background: var(--shu-bg-input); cursor: pointer; border-radius: var(--shu-radius); }
			/* The in-view thumb wants clear contrast against the rail track so the reader sees where they are at a glance. */
			.thumb { position: absolute; left: 0; right: 0; background: var(--shu-fg-muted); min-height: 16px; border-radius: var(--shu-radius); cursor: grab; }
			.thumb:hover { background: var(--shu-fg); }
			.thumb:active { cursor: grabbing; }
			.marker { position: absolute; left: 50%; transform: translate(-50%, -50%); font-size: var(--shu-font-md); line-height: 1; cursor: pointer; opacity: 0.85; pointer-events: auto; }
			.marker:hover { opacity: 1; }
			.marker sub { font-size: 0.6em; opacity: 0.8; }
		`,
	];

	#railPx = 0;
	#ro: ResizeObserver | null = null;

	protected override onConnected(): void {
		if (typeof ResizeObserver === "undefined") return; // a non-DOM host (a unit-test env) has no resize; the rail still works, just without resize-driven repaint
		// Rail height drives every position; re-render when it changes (split pane resize, orientation) instead of reading
		// layout during render.
		this.#ro = new ResizeObserver(() => {
			const rail = this.#rail();
			const h = rail?.clientHeight ?? 0;
			if (h !== this.#railPx) {
				this.#railPx = h;
				this.requestUpdate();
			}
		});
		if (this.#rail()) this.#ro.observe(this.#rail() as Element);
	}

	protected override onDisconnected(): void {
		this.#ro?.disconnect();
		this.#ro = null;
	}

	protected updated(): void {
		const rail = this.#rail();
		if (rail && this.#ro) this.#ro.observe(rail); // observe once the rail exists (idempotent)
	}

	#rail(): HTMLElement | null {
		return this.shadowRoot?.querySelector(".rail") ?? null;
	}

	/** An empty column has nothing to scroll, so its thumb fills the rail rather than shrinking to the minimum. */
	#fraction(): number {
		return this.viewportFraction ?? (this.total > 0 ? this.window.visible / this.total : 1);
	}

	/** This element's thumb height, from the one model definition — the rail geometry and the pointer mapping share it. */
	#thumbPx(railPx: number): number {
		return thumbHeightPx(this.#fraction(), railPx);
	}

	render(): TemplateResult {
		const railPx = this.#railPx;
		const heightPx = this.#thumbPx(railPx);
		const topPx = thumbTopPx(this.total, this.window, railPx, heightPx);
		const marks = clusterMarkers(this.markers, this.total, railPx, heightPx);
		return html`
			<span class="pos pos-top" data-testid=${SHU_TEST_IDS.SCROLLBAR.POS_TOP}>${this.showPosition && this.total ? formatCount(this.window.first + 1) : ""}</span>
			<div class="rail" data-testid=${SHU_TEST_IDS.SCROLLBAR.RAIL} @pointerdown=${this.#onRailDown} @wheel=${this.#onWheel}>
				<div class="thumb" data-testid=${SHU_TEST_IDS.SCROLLBAR.THUMB} style=${`top:${topPx}px;height:${heightPx}px`} @pointerdown=${this.#onThumbDown}></div>
				${marks.map(
					(m) =>
						html`<span class="marker" style=${`top:${m.topPx}px;color:${m.color}`} title=${m.label ?? m.id} data-testid=${SHU_TEST_IDS.SCROLLBAR.MARKER} @pointerdown=${(e: Event) => this.#onMarker(e, m.index)}
							>${m.icon}${m.count > 1 ? html`<sub>${m.count}</sub>` : ""}</span
						>`,
				)}
			</div>
			<span class="pos pos-bottom" data-testid=${SHU_TEST_IDS.SCROLLBAR.POS_BOTTOM}>${this.showPosition && this.total ? formatCount(this.total) : ""}</span>
		`;
	}

	#emit(index: number): void {
		const clamped = Math.max(0, Math.min(index, Math.max(0, this.total - this.window.visible)));
		this.dispatchEvent(new CustomEvent(SCROLL_TO_INDEX, { detail: { index: clamped }, bubbles: true, composed: true }));
	}

	#pointerToIndex(clientY: number): number {
		const rail = this.#rail();
		if (!rail) return this.window.first;
		const rect = rail.getBoundingClientRect();
		return firstAtPointer(this.total, this.window.visible, clientY - rect.top, rect.height, this.#thumbPx(rect.height));
	}

	#dragId: number | null = null;

	#onRailDown = (e: PointerEvent): void => {
		if (this.#dragId !== null) return; // a thumb drag is in flight
		this.#emit(this.#pointerToIndex(e.clientY));
	};

	#onThumbDown = (e: PointerEvent): void => {
		if (this.#dragId !== null) return; // a drag is already in flight; a second finger must not hijack it (mirrors #onRailDown)
		e.stopPropagation();
		const thumb = e.currentTarget as HTMLElement;
		thumb.setPointerCapture(e.pointerId);
		this.#dragId = e.pointerId;
		thumb.addEventListener("pointermove", this.#onThumbMove);
		thumb.addEventListener("pointerup", this.#onThumbUp);
		thumb.addEventListener("pointercancel", this.#onThumbUp);
	};

	#onThumbMove = (e: PointerEvent): void => {
		if (this.#dragId !== e.pointerId) return;
		this.#emit(this.#pointerToIndex(e.clientY));
	};

	#onThumbUp = (e: PointerEvent): void => {
		const thumb = e.currentTarget as HTMLElement;
		thumb.releasePointerCapture(e.pointerId);
		thumb.removeEventListener("pointermove", this.#onThumbMove);
		thumb.removeEventListener("pointerup", this.#onThumbUp);
		thumb.removeEventListener("pointercancel", this.#onThumbUp);
		this.#dragId = null;
	};

	#onMarker = (e: Event, index: number): void => {
		e.stopPropagation();
		this.#emit(index);
	};

	#onWheel = (e: WheelEvent): void => {
		e.preventDefault();
		const step = Math.sign(e.deltaY) * Math.max(1, Math.round(this.window.visible * 0.5));
		this.#emit(this.window.first + step);
	};
}

customElements.define("shu-scrollbar", ShuScrollbar);
