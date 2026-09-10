/**
 * <shu-scrollbar>: the custom vertical scroll rail for a virtualized column: a thumb sized to the viewport's share of the column, a
 * position glyph at each end (first visible row ordinal, total), and marker glyphs on the rail for significant rows
 * anywhere in the full data set (annotations, failed steps, feature boundaries) so a reader sees them across the whole
 * column and can jump to one even when it is far outside the rendered window. It is the only usable scroll affordance in
 * immersive WebXR (native scrollbars are not composited there) and can show position inside a fetched set of millions,
 * which a native scrollbar cannot. Geometry is the pure, tested scrollbar-model; this element is the DOM wiring.
 *
 * It drives nothing itself: it emits `scroll-to-index` and the column (which owns the virtualizer) scrolls. Input is
 * unified through Pointer Events so mouse, touch, and pen behave identically on every device.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { z } from "zod";
import { property } from "lit/decorators.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { shuBaseStyles } from "./styles.js";
import { startPointerDrag } from "./pointer-drag.js";
import { thumbHeightPx, thumbTopPx, firstAtPointer, clusterMarkers, formatCount, markerTopPx, pressTarget, type TScrollMarker, type TWindow } from "../scrollbar-model.js";

const EmptySchema = z.object({});

/** Emitted (bubbling, composed) with `{ index }` when the reader drags the thumb, clicks the rail, wheels, or clicks a
 *  marker: the column should scroll so `index` is the first visible row. */
export const SCROLL_TO_INDEX = "scroll-to-index";

/** How the reader asked. A press or a drag on the rail is someone saying where they want to be; a wheel over it is
 *  reading, the same as wheeling the rows. A view that acts on more than scrolling, moving the shared time cursor,
 *  say: cares which, and would otherwise drag every other view along with a scroll gesture. */
export type TSeekBy = "press" | "wheel";
/** A press on one of the rail's position glyphs: the top one asks for the START of the run, the bottom one for its live
 *  END: beyond what the rail's rows hold, which a host that pages its data answers by loading to that edge. */
export type TSeekEdge = "start" | "end";

export class ShuScrollbar extends ShuElement<typeof EmptySchema> {
	constructor() {
		super(EmptySchema, {});
	}

	/** A control, not a view of data, contributes nothing to the Kihan's context. */
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

	/** Where the shared time cursor sits, as an absolute index, or -1 for no cursor at all. The thumb says what is on
	 *  screen; this says which moment every view is showing. They are different things and are drawn differently: the
	 *  thumb fills the track, the cursor is a mark down its left edge. */
	@property({ attribute: false }) accessor cursor = -1;

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; align-items: center; width: var(--shu-scrollbar-w); flex-shrink: 0; user-select: none; touch-action: none; }
			.pos { font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-1) 0; line-height: 1; font-weight: 500; font-variant-numeric: tabular-nums; cursor: pointer; min-height: 1em; }
			.pos-bottom { margin-top: auto; }
			/* The rail takes the WHOLE width of the control, because that is the target a reader aims at: a 14px track asks
			   for a precision nobody should need, least of all in a collapsed column where this is the only control there
			   is. What is drawn stays narrow, the track below is the visible band, while every pixel across is live. */
			.rail { position: relative; flex: 1; width: 100%; cursor: pointer; }
			.track {
				position: absolute; top: 0; bottom: 0; left: 50%; transform: translateX(-50%);
				width: var(--shu-rail-track-w); background: var(--shu-bg-input); border-radius: var(--shu-radius); pointer-events: none;
			}
			/* The in-view thumb wants clear contrast against the rail track so the reader sees where they are at a glance. */
			/* Above the marks, so a press on the thumb is a drag: the marks come after it in the DOM and would otherwise take
			   it, which on a densely marked rail means the thumb can barely be grabbed at all. Translucent so the marks it
			   covers still show through: they are the rows on screen, and the reader should still see what is among them. */
			.thumb {
				position: absolute; left: 50%; transform: translateX(-50%); width: var(--shu-rail-track-w);
				background: var(--shu-fg-muted); min-height: 16px; border-radius: var(--shu-radius); cursor: grab;
				z-index: 2; opacity: 0.6;
			}
			.thumb:hover { background: var(--shu-fg); opacity: 0.8; }
			.thumb:active { cursor: grabbing; }
			/* A LINE ACROSS the rail, not a block on it. Everything else here is a block: the thumb is a bar down the
			   track, every event is a chip on it, so a cursor drawn as one more block reads as one more of them however
			   it is coloured. Crossing the rail is a shape nothing else uses, which is what makes it findable at a glance
			   down a dense rail, and it sits above the marks so a chip can never hide it. The caret at the left end gives
			   the line a definite anchor, and the shadow keeps both readable where they cross a bright chip. */
			.cursor {
				position: absolute; left: 0; right: 0;
				height: 0; transform: translateY(-50%); pointer-events: none; z-index: 3;
				border-top: 2px solid var(--shu-fg); filter: drop-shadow(0 1px 0 var(--shu-bg)) drop-shadow(0 -1px 0 var(--shu-bg));
			}
			.cursor::before {
				content: ""; position: absolute; left: 0; top: -6px;
				border: 5px solid transparent; border-left-color: var(--shu-fg); border-right-width: 0;
			}
			.marker { position: absolute; left: 50%; transform: translate(-50%, -50%); font-size: var(--shu-font-md); line-height: 1;  opacity: 0.85; z-index: 1; }
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
		this.#stopDrag?.(); // a rail closed mid-drag would otherwise keep reading the pointer
		this.#stopDrag = null;
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

	/** This element's thumb height, from the one model definition: the rail geometry and the pointer mapping share it. */
	#thumbPx(railPx: number): number {
		return thumbHeightPx(this.#fraction(), railPx);
	}

	render(): TemplateResult {
		const railPx = this.#railPx;
		const heightPx = this.#thumbPx(railPx);
		const topPx = thumbTopPx(this.total, this.window, railPx, heightPx);
		const marks = this.#marks(railPx);
		return html`
			<span class="pos pos-top" data-testid=${SHU_TEST_IDS.SCROLLBAR.POS_TOP} title="To the start" @click=${() => this.#emit(0, "press", "start")}>${this.showPosition && this.total ? formatCount(this.window.first + 1) : "⤒"}</span>
			<div class="rail" data-testid=${SHU_TEST_IDS.SCROLLBAR.RAIL} @pointerdown=${this.#onRailDown} @wheel=${this.#onWheel}>
				<div class="track"></div>
				${
					// A thumb says how much of the column is on screen. In a collapsed column nothing is, and before the first
					// window is reported nothing is known, in both cases a thumb would be a claim nobody has made, and in a
					// strip a large one sits over the marks a reader is trying to point at. It appears when there is a
					// viewport for it to be the size of.
					this.window.visible > 0 && !this.columnCollapsed
						? html`<div class="thumb" data-testid=${SHU_TEST_IDS.SCROLLBAR.THUMB} style=${`top:${topPx}px;height:${heightPx}px`} @pointerdown=${this.#onThumbDown}></div>`
						: nothing
				}
				${
					this.cursor < 0
						? nothing
						: html`<span class="cursor" data-testid=${SHU_TEST_IDS.SCROLLBAR.CURSOR} title="the moment being shown"
								style=${`top:${markerTopPx(this.cursor, this.total, railPx)}px`}></span>`
				}
				${marks.map(
					(m) =>
						html`<span class="marker" style=${`top:${m.topPx}px;color:${m.color}`} title=${m.label ?? m.id} data-testid=${SHU_TEST_IDS.SCROLLBAR.MARKER}
							>${m.icon}${m.count > 1 ? html`<sub>${m.count}</sub>` : ""}</span
						>`,
				)}
			</div>
			<span class="pos pos-bottom" data-testid=${SHU_TEST_IDS.SCROLLBAR.POS_BOTTOM} title="To the end" @click=${() => this.#emit(Math.max(0, this.total - 1), "press", "end")}>${this.showPosition && this.total ? formatCount(this.total) : "⤓"}</span>
		`;
	}

	/** Say which row the reader picked. A ROW, not a window start: the last `visible` rows begin no window, and clamping
	 *  here would make them unpickable, which is a scroller's limit, not a reader's. What to show is the scroller's to
	 *  work out from this. */
	#emit(index: number, by: TSeekBy, edge?: TSeekEdge): void {
		const row = Math.max(0, Math.min(index, Math.max(0, this.total - 1)));
		this.dispatchEvent(new CustomEvent(SCROLL_TO_INDEX, { detail: { index: row, by, ...(edge ? { edge } : {}) }, bubbles: true, composed: true }));
	}

	/**
	 * The row a pointer at `clientY` means. `snapToMarks` is what separates the two ways of pointing: a press on the
	 * rail may mean the mark it landed on, while a thumb drag is a position and nothing else: a drag that snapped to
	 * marks would stick to them as it passed.
	 */
	#pointerToIndex(clientY: number, snapToMarks = false): number {
		const rect = this.#rail()?.getBoundingClientRect();
		if (!rect) return this.window.first;
		const heightPx = this.#thumbPx(rect.height);
		// A drag takes the window scale: the thumb has to stay under the pointer that is dragging it. A press takes the
		// row scale, through pressTarget, so every row can be pointed at.
		const at = clientY - rect.top;
		if (!snapToMarks) return firstAtPointer(this.total, this.window.visible, at, rect.height, heightPx);
		return pressTarget(at, this.#marks(rect.height), this.total, rect.height);
	}

	/** The marks as drawn, held so a render and a press cannot cluster the same marks twice: the clustering maps and
	 *  sorts every marker, a long run supplies thousands, and the rail re-renders whenever the cursor moves. Keyed on the
	 *  marker array ITSELF, not its length: a host that re-derives its marks hands over a new array, while a filter that
	 *  swapped which rows are marked without changing how many would slip past a count. */
	#clustered: { of: TScrollMarker[]; key: string; marks: Array<TScrollMarker & { topPx: number; count: number }> } | null = null;

	#marks(railPx: number): Array<TScrollMarker & { topPx: number; count: number }> {
		const key = `${this.total}:${railPx}`;
		if (this.#clustered?.of !== this.markers || this.#clustered.key !== key) {
			this.#clustered = { of: this.markers, key, marks: clusterMarkers(this.markers, this.total, railPx) };
		}
		return this.#clustered.marks;
	}

	#dragId: number | null = null;
	/** The thumb drag in flight, so a rail that goes away mid-drag takes it with it. */
	#stopDrag: (() => void) | null = null;

	#onRailDown = (e: PointerEvent): void => {
		if (this.#dragId !== null) return; // a thumb drag is in flight
		this.#emit(this.#pointerToIndex(e.clientY, true), "press");
	};

	#onThumbDown = (e: PointerEvent): void => {
		if (this.#dragId !== null) return; // a drag is already in flight; a second finger must not hijack it (mirrors #onRailDown)
		e.stopPropagation();
		this.#dragId = e.pointerId;
		// A press that never moves is a click, and a click on the rail goes to where it landed: the same as pressing the
		// track beside the thumb. Without this, a press the pointer never carries anywhere does nothing at all, which is
		// what a tap is on a touch screen and what a click is on anything the thumb happens to be covering.
		const pressedAt = e.clientY;
		let carried = false;
		this.#stopDrag = startPointerDrag(e, {
			onMove: (ev) => {
				carried = true;
				this.#emit(this.#pointerToIndex(ev.clientY), "press");
			},
			onEnd: () => {
				// A click means the row at that height: the same as a click anywhere else on the rail. Only the DRAG above
				// uses the window scale, and only because a thumb has to stay under the pointer dragging it. Answering a
				// click that way put every press inside the thumb at the thumb's own top row, which is most of the rail
				// once a viewport holds a good share of the log, and sits over exactly the later moments.
				if (!carried) this.#emit(this.#pointerToIndex(pressedAt, true), "press");
				this.#stopDrag = null;
				this.#dragId = null;
			},
		});
	};

	#onWheel = (e: WheelEvent): void => {
		e.preventDefault();
		const step = Math.sign(e.deltaY) * Math.max(1, Math.round(this.window.visible * 0.5));
		this.#emit(this.window.first + step, "wheel");
	};
}

customElements.define("shu-scrollbar", ShuScrollbar);
