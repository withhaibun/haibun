/**
 * <shu-virtual-column> — a scrolling column that materializes only its visible window over any WindowedSource, paired
 * with the custom glyph scrollbar. The one virtualization host every row-list column uses: give it a `source` and a
 * `renderRow`; it renders O(viewport) rows regardless of the total (tested to millions), pages data in on demand, and
 * paints the rail with position and annotation-marker glyphs. Light DOM, so the same element can also be layered over
 * the polymorphic view canvas as an overlay (the a-frame path); the WindowedSource it reads can equally drive a 3D rail.
 *
 * It owns scrolling but not the data: `visibilityChanged` from the virtualizer sets the window and prefetches it; the
 * scrollbar emits `scroll-to-index` and the virtualizer scrolls. Live-follow is the shared `FollowController` (the one
 * tested tailing kit every timeline view uses): the jump-to-edge is scrollToIndex(last, "end") re-issued until the window
 * reaches the last row, real reader input (wheel/touch, rail seek) pauses the tail, the window reaching the last row
 * resumes it, and the `timeCursor` signal reaching the live edge (null) re-engages it.
 *
 * It renders in LIGHT DOM, like lit-virtualizer itself, so the whole subtree lives in the HOST column's shadow and the
 * host's row styles reach the virtualized rows (a shadow-DOM wrapper would trap them). The host includes
 * `virtualColumnCss` in its own `static styles` for the layout the element needs; the rows are styled by the host.
 */
import { html, css, type TemplateResult, type CSSResultGroup } from "lit";
import { z } from "zod";
import { property } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import "@lit-labs/virtualizer";
import type { LitVirtualizer } from "@lit-labs/virtualizer/LitVirtualizer.js";
import type { VisibilityChangedEvent } from "@lit-labs/virtualizer/events.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { railTotalAndWindow } from "../annotation-rail.js";
import { VIEW_THUMB_BLIP, VIEW_SCROLL_BLIP, VIEW_WINDOW_BLIP, READER_INPUT_WINDOW_MS } from "../view-blips.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { WindowedSource } from "../windowed-source.js";
import type { TScrollMarker, TWindow } from "../scrollbar-model.js";
import { visibleWindow, convergeTarget } from "../virtual-column-model.js";
import { FollowController } from "../timeline-follow.js";

const EmptySchema = z.object({});

/** Cap on re-issuing the jump-to-edge as the virtualizer measures its way down to the last row: a handful of passes closes
 *  the height-estimate gap; the bound stops an unreachable target (a row that can't fit) from re-jumping forever. */
/** Resolution the viewport share is held at — finer than a pixel on any rail worth drawing, so the thumb only resizes
 *  when the resize is visible. */
const FRACTION_STEPS = 512;

/** How many pixels above its end a followed pane may sit and still count as at the live edge: the height-estimate
 *  overshoot below the last row is tens of pixels, a stalled follow is hundreds. One contract, shared with the control
 *  that asserts it. */
export const FOLLOW_EDGE_SLACK_PX = 200;

const MAX_CONVERGE = 40;

/** Paint one row: the absolute `index` and its data (`undefined` when the source has not fetched it yet — return a
 *  skeleton). */
export type TVirtualRow = (index: number, row: unknown) => TemplateResult;

/** Layout the element needs, for the HOST column to include in its own `static styles`: the element renders in light DOM
 *  (so it has no shadow styles of its own), and its subtree lives in the host's shadow where these rules and the host's
 *  own row rules both apply. */
export const virtualColumnCss: CSSResultGroup = css`
	shu-virtual-column { display: flex; min-height: 0; flex: 1; }
	/* The virtualizer owns scrolling; its native scrollbar is hidden because the custom rail drives and reads it. */
	shu-virtual-column lit-virtualizer { flex: 1; min-height: 0; overflow: auto; scrollbar-width: none; -ms-overflow-style: none; }
	shu-virtual-column lit-virtualizer::-webkit-scrollbar { width: 0; height: 0; }
	/* Serving as a column's spine: the rail is the whole of it, filling the strip's height. */
	shu-virtual-column[spine] { flex: 1; min-height: 0; }
	shu-virtual-column[spine] .spine-rail { display: flex; flex: 1; min-height: 0; }
`;

/** Fired (bubbling, composed) when this scroller's follow state flips: pinned to the live edge (`following: true`) or the
 *  reader has scrolled back / follow is off (`following: false`). A host that bounds its data window — the monitor — listens
 *  to switch between a live-tail window and the full history. Additive: it never changes the follow behaviour itself. */
export const FOLLOW_CHANGED = "shu-follow-changed";
export type FollowChangedDetail = { following: boolean };

export class ShuVirtualColumn extends ShuElement<typeof EmptySchema> {
	constructor() {
		super(EmptySchema, {});
	}

	/** The hosting column summarizes its data for a Kihan; this element is just the scroller shell. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	@property({ attribute: false }) accessor source: WindowedSource<unknown> | null = null;
	@property({ attribute: false }) accessor renderRow: TVirtualRow = () => html``;
	/** Whether this view tails at all — its live-log capability (a monitor's tail toggle). When on, the follow kit's rules
	 *  decide moment to moment whether to stick to the live edge; when off, the view never auto-scrolls. */
	@property({ type: Boolean }) accessor follow = false;

	/** Serving as its column's spine: render the rail and not the rows. The element itself stays, which is the point —
	 *  the window it is showing is its own field, so collapsing a column does not lose where the reader was. */
	@property({ type: Boolean }) accessor spine = false;

	/** The row the shared time cursor sits on, or -1 for none. Passed straight to the rail, which draws it: this column
	 *  knows about rows, not about time, so it carries the index its host worked out rather than deciding one. */
	@property({ attribute: false }) accessor cursor = -1;

	/** Light DOM: the virtualized rows must be styled by the host column, and lit-virtualizer itself renders in light DOM. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	#virt = createRef<LitVirtualizer>();
	// Live-follow: the jump-to-edge is the virtualizer's scrollToIndex(last, "end"), re-issued while the reported window is
	// still short of the last row (each pass measures further down, converging on the true bottom). PAUSE comes only from
	// real reader input — a wheel/touch scroll or a rail seek — never from scroll events or the virtualizer's pin state:
	// its estimated scroll-height and rebuild-time corrections make both misreport the follow's own motion as a reader
	// scrolling away, which false-paused the tail. RESUME is the reported window reaching the last row again.
	#follow = new FollowController(this, () => this.#scrollToEnd());
	#window: TWindow = { first: 0, visible: 0 };
	#viewportFraction: number | undefined;
	#measureQueued = false;
	#convergeFor = -1; // the row count the convergence passes below are chasing
	#convergeCount = 0; // passes spent chasing it, bounded by MAX_CONVERGE
	#items: unknown[] = [];
	#itemCount = -1;
	#unsub: (() => void) | null = null;
	#lastFollowing = false; // last-emitted follow state, so FOLLOW_CHANGED fires only on a transition
	// Change gates for the occurrences this view records: only a movement records, so a stable reading costs nothing.
	#lastRawFraction: number | undefined;
	#lastScrollTop: number | undefined;
	#lastWindowShort: number | undefined;
	#readerInputAt = 0; // when the reader last touched the view, so a scroll can say who moved it

	/** Emit FOLLOW_CHANGED when the pinned-to-live-edge state flips (follow enabled AND the reader at the edge). A host that
	 *  windows its data listens for this to switch between a live-tail span and the full history. Only fires on a transition. */
	#emitFollow(): void {
		const following = this.follow && this.#follow.isFollowing;
		if (following === this.#lastFollowing) return;
		this.#lastFollowing = following;
		this.dispatchEvent(new CustomEvent<FollowChangedDetail>(FOLLOW_CHANGED, { detail: { following }, bubbles: true, composed: true }));
	}

	protected override onConnected(): void {
		this.#subscribe();
		// Listen for the rail's scroll request via the exported const, not a hardcoded event name, so a rename can't
		// silently break marker-jump. The event bubbles (composed) from the child shu-scrollbar.
		this.autoListen(this, SCROLL_TO_INDEX, this.#onScrollTo as EventListener);
		// Real reader input pauses the tail. Any wheel/touch scroll counts: one that ends back at the bottom re-engages
		// instantly via the window-reaches-last resume, so no direction check is needed.
		this.autoListen(this, "wheel", this.#onUserScroll, { passive: true });
		this.autoListen(this, "touchmove", this.#onUserScroll, { passive: true });
		// Scroll does not bubble but is capturable, so one listener here sees the virtualizer scroller move.
		this.autoListen(this, "scroll", this.#onAnyScroll, { passive: true, capture: true });
	}

	#onAnyScroll = (e: Event): void => {
		const scroller = this.#virt.value;
		if (!scroller || e.target !== scroller) return;
		const top = scroller.scrollTop;
		const delta = this.#lastScrollTop === undefined ? 0 : top - this.#lastScrollTop;
		this.#lastScrollTop = top;
		if (delta !== 0) this.recordBlip(VIEW_SCROLL_BLIP, delta, { reason: Date.now() - this.#readerInputAt < READER_INPUT_WINDOW_MS ? "reader" : "system" });
		// The live edge moves on appended rows AND on content measured taller after the fact. The second case arrives as
		// exactly this event: a scroll while the reader is pinned, leaving the pane short of its end in pixels even when
		// the row window already holds the last index (recorded occurrences showed the document column settling 1396px
		// short that way, index-converged and pixel-drifted). Re-stick once this move has landed; a stick that moves
		// nothing emits no scroll, so the chain ends by itself.
		if (this.follow && this.#follow.isFollowing)
			requestAnimationFrame(() => {
				const el = this.#virt.value;
				if (el && this.#follow.isFollowing && el.scrollHeight - (el.scrollTop + el.clientHeight) > FOLLOW_EDGE_SLACK_PX) this.#follow.stick();
			});
	};

	protected override onDisconnected(): void {
		this.#unsub?.();
		this.#unsub = null;
	}

	protected updated(changed: Map<string, unknown>): void {
		if (changed.has("source")) this.#subscribe();
		// Leaving the strip, the virtualizer is rendered again and starts at the top. The window survived in this
		// element, so the rows are put back under it: expanding a column returns the reader to where they were rather
		// than to the live edge.
		if (changed.has("spine") && changed.get("spine") === true && !this.spine && this.#window.visible > 0) {
			// The virtualizer was just rendered again and has measured nothing, so one scroll lands short. The target is
			// held and re-driven by #onVisibility until the window reports it, the same convergence the follow kit uses.
			this.#restoreFirst = this.#window.first;
			this.#restoreTries = 0;
			this.scrollToIndex(this.#restoreFirst);
		}
	}

	#subscribe(): void {
		this.#unsub?.();
		let lastCount = -1;
		this.#unsub =
			this.source?.subscribe(() => {
				this.requestUpdate();
				// After an appended row commits, ask the follow kit to stick — it jumps ONLY while the reader is still at the
				// live edge (following, cursor null), so a scrolled-up reader is left alone. Only a changed row count moves
				// the live edge; a notify that recomputed the same rows (a filter pass over a buffer that gained only
				// filtered-out events) must not re-stick, or it overrides a scroll position nothing visible asked to change.
				const count = this.source?.count() ?? 0;
				const moved = count !== lastCount;
				lastCount = count;
				if (moved && this.follow) void this.updateComplete.then(() => this.#follow.stick());
			}) ?? null;
	}

	/** Scroll so `index` is at the top of the viewport. For a jump-to from another view (a framed row a reader clicked). */
	scrollToIndex(index: number, position: "start" | "center" | "end" = "start"): void {
		this.#virt.value?.scrollToIndex(index, position);
	}

	/** The follow kit's jump-to-live-edge for this virtualized scroller: put the last row at the bottom of the viewport.
	 *  Always the virtualizer's own scrollToIndex, never a raw scrollTop (which fights its scroll management). The target
	 *  is convergeTarget's two-gait choice (see virtual-column-model.ts), re-driven by #onVisibility until the window
	 *  holds the last row. */
	#scrollToEnd(): void {
		const el = this.#virt.value;
		const n = this.source?.count() ?? 0;
		if (!el || n === 0) return;
		el.scrollToIndex(convergeTarget(this.#window, n), "end");
	}

	/** The placeholder items array of length `count`, memoized so scrolling a million-row column never rebuilds it; the
	 *  virtualizer reads only the visible indices, so a sparse array of that length is cheap. */
	#itemsFor(count: number): unknown[] {
		if (count !== this.#itemCount) {
			// Fill with a defined sentinel, not holes: lit-virtualizer's element(i)/scrollToIndex treats an `undefined` item
			// as a non-existent index and refuses to scroll there, so a rail drag or marker jump to an off-screen row would
			// silently no-op. The row data itself always comes from the source (rowAt), never this array; this is only the
			// length-carrying placeholder. Rebuilt only on a count change (the same cost profile as the source's own update).
			this.#items = count > 0 ? new Array(count).fill(0) : [];
			this.#itemCount = count;
		}
		return this.#items;
	}

	/** Where to put the reader back after the rows return from the strip, and how many attempts are left to get there.
	 *  Bounded, so a target the content can never reach (a shortened log) gives up rather than re-scrolling forever. */
	#restoreFirst: number | null = null;
	#restoreTries = 0;

	#onVisibility = (e: VisibilityChangedEvent): void => {
		this.#window = visibleWindow(e.first, e.last);
		if (this.#restoreFirst !== null) {
			if (this.#window.first === this.#restoreFirst || this.#restoreTries++ >= 8) this.#restoreFirst = null;
			else this.scrollToIndex(this.#restoreFirst);
		}
		if (this.source && e.last >= e.first) void this.source.ensureRange(e.first, e.last + 1);
		const count = this.source?.count() ?? 0;
		const short = Math.max(0, count - (this.#window.first + this.#window.visible));
		if (short !== this.#lastWindowShort) {
			this.#lastWindowShort = short;
			this.recordBlip(VIEW_WINDOW_BLIP, short, { first: this.#window.first, visible: this.#window.visible, count, following: this.follow && this.#follow.isFollowing });
		}
		if (this.follow && count > 0) {
			if (this.#window.first + this.#window.visible >= count) {
				// The last row is inside the reported window — the reader is at (or scrolled back to) the live edge. Resume (the
				// follow's own scroll also lands here, keeping follow engaged) and end this target's convergence.
				this.#follow.setAtBottom(true);
				this.#convergeFor = count;
				this.#convergeCount = MAX_CONVERGE;
			} else if (this.#follow.isFollowing) {
				// Following but short of the last row — including the very first report of a view that opened parked at the top,
				// whose source filled before this element subscribed. Re-issue the jump: this pass measured further down, so the
				// next lands closer — bounded per target so an unreachable last row can't re-jump forever.
				if (this.#convergeFor !== count) (this.#convergeFor = count), (this.#convergeCount = 0);
				if (this.#convergeCount < MAX_CONVERGE) (this.#convergeCount += 1), void this.updateComplete.then(() => this.#follow.stick());
			}
		}
		this.#emitFollow(); // tell a windowing host if this pass reached / left the live edge
		this.requestUpdate(); // reposition the rail thumb and glyphs
		this.#scheduleMeasure();
	};

	/** The viewport's share of the column, for the rail's thumb: rows here can differ in height (a run document holds both
	 *  a line of prose and a screenshot), so the scroller's own pixels are what "how much is on screen" means.
	 *
	 *  Measured on a frame of its own, never inside the virtualizer's range event: reading scrollHeight there forces layout
	 *  in the middle of the virtualizer's own measuring. */
	#scheduleMeasure(): void {
		if (this.#measureQueued) return;
		this.#measureQueued = true;
		requestAnimationFrame(() => {
			this.#measureQueued = false;
			const scroller = this.#virt.value;
			if (!scroller) return;
			const { total, window } = railTotalAndWindow(scroller);
			// Quantised: the virtualizer revises its total-height estimate continuously while a reader scrolls, and a
			// revision too small to move the thumb a whole pixel must not re-render the rail (the thumb would twitch).
			const fraction = total > 0 ? Math.round((window.visible / total) * FRACTION_STEPS) / FRACTION_STEPS : undefined;
			// Every raw movement records, before quantisation decides whether the thumb redraws: the revisions
			// quantisation absorbs are where a jitter hides. `rendered` marks the ones that reached the screen.
			const raw = total > 0 ? window.visible / total : undefined;
			if (raw !== undefined && raw !== this.#lastRawFraction) {
				this.#lastRawFraction = raw;
				this.recordBlip(VIEW_THUMB_BLIP, raw, { visible: window.visible, total, rendered: fraction !== this.#viewportFraction });
			}
			if (fraction === this.#viewportFraction) return;
			this.#viewportFraction = fraction;
			this.requestUpdate();
		});
	}

	// Real reader input is the one reliable pause signal: scroll events and the virtualizer's pin state both misreport the
	// follow's own motion (estimate corrections) as a reader scrolling away.
	#onUserScroll = (): void => {
		this.#readerInputAt = Date.now();
		if (this.follow) this.#follow.setAtBottom(false);
		this.#emitFollow();
	};

	#onScrollTo = (e: Event): void => {
		this.#readerInputAt = Date.now();
		// A rail drag or marker jump is the reader navigating to a specific row — an explicit move away from the live edge, so
		// pause the follow. Otherwise the convergence, seeing the seeked window short of the last row, would re-jump the tail
		// back to the bottom and fight the seek. Landing on the last row re-engages follow via the window-reaches-last path.
		if (this.follow) this.#follow.setAtBottom(false);
		this.#emitFollow();
		const index = (e as CustomEvent<{ index: number }>).detail.index;
		// In the strip there are no rows to scroll, so the rail moves the window itself. That is what makes the strip a
		// control rather than a picture: the reader drags it to a place in the run, and expanding puts the rows there.
		if (this.spine) {
			this.#window = { first: index, visible: this.#window.visible };
			this.requestUpdate();
			return;
		}
		this.#virt.value?.scrollToIndex(index, "start");
	};

	render(): TemplateResult {
		const total = this.source?.count() ?? 0;
		const rail = html`<shu-scrollbar .total=${total} .window=${this.#window} .viewportFraction=${this.#viewportFraction} .markers=${(this.source?.markers() ?? []) as TScrollMarker[]} .cursor=${this.cursor}></shu-scrollbar>`;
		// Serving as a column's spine: the strip has room for the rail and nothing else. The rows are not rendered, and
		// the rail keeps the same window over the same source, so collapsing does not move the reader.
		if (this.spine) return html`<div class="spine-rail">${rail}</div>`;
		// lit-virtualizer requires a ResizeObserver to measure and virtualize. A non-DOM host (a jsdom unit test) has none,
		// so fall back to a plain list there; every real browser has one, so this branch is test-only and the O(viewport)
		// behavior is proven by the browser e2e.
		if (typeof ResizeObserver === "undefined") {
			return html`<div class="virtual-fallback">${Array.from({ length: total }, (_, i) => this.renderRow(i, this.source?.rowAt(i)))}</div>
				${rail}`;
		}
		return html`
			<lit-virtualizer
				${ref(this.#virt)}
				scroller
				.items=${this.#itemsFor(total)}
				.keyFunction=${(_: unknown, i: number) => i}
				.renderItem=${(_: unknown, i: number) => this.renderRow(i, this.source?.rowAt(i))}
				@visibilityChanged=${this.#onVisibility}
			></lit-virtualizer>
			${rail}`;
	}
}

customElements.define("shu-virtual-column", ShuVirtualColumn);
