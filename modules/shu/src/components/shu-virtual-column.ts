/**
 * <shu-virtual-column> — a scrolling column that materializes only its visible window over any WindowedSource, paired
 * with the custom glyph scrollbar. The one virtualization host every row-list column uses: give it a `source` and a
 * `renderRow`; it renders O(viewport) rows regardless of the total (tested to millions), pages data in on demand, and
 * paints the rail with position and annotation-marker glyphs. Light DOM, so the same element can also be layered over
 * the fisheye canvas as an overlay (the a-frame path); the WindowedSource it reads can equally drive a 3D rail.
 *
 * It owns scrolling but not the data: `visibilityChanged` from the virtualizer sets the window and prefetches it; the
 * scrollbar emits `scroll-to-index` and the virtualizer scrolls. Live-follow is virtualization-aware (stick to the last
 * row as the source appends, only while the reader is at the end and at the live time edge), so it needs no scroll
 * element wired ahead of the first render.
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
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { WindowedSource } from "../windowed-source.js";
import type { TScrollMarker, TWindow } from "../scrollbar-model.js";
import { visibleWindow, shouldFollow } from "../virtual-column-model.js";

const EmptySchema = z.object({});

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
`;

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
	/** Stick to the last row as the source appends (a live log), until the reader scrolls away or scrubs into the past. */
	@property({ type: Boolean }) accessor follow = false;

	/** Light DOM: the virtualized rows must be styled by the host column, and lit-virtualizer itself renders in light DOM. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	#virt = createRef<LitVirtualizer>();
	#window: TWindow = { first: 0, visible: 0 };
	#items: unknown[] = [];
	#itemCount = -1;
	#unsub: (() => void) | null = null;

	protected override onConnected(): void {
		this.#subscribe();
		// Listen for the rail's scroll request via the exported const, not a hardcoded event name, so a rename can't
		// silently break marker-jump. The event bubbles (composed) from the child shu-scrollbar.
		this.autoListen(this, SCROLL_TO_INDEX, this.#onScrollTo as EventListener);
	}

	protected override onDisconnected(): void {
		this.#unsub?.();
		this.#unsub = null;
	}

	protected updated(changed: Map<string, unknown>): void {
		if (changed.has("source")) this.#subscribe();
	}

	#subscribe(): void {
		this.#unsub?.();
		this.#unsub =
			this.source?.subscribe(() => {
				// Capture "was at the end" against the PRE-append count before the render updates it.
				// Decide against the PRE-append count, before the render updates it (see shouldFollow).
				const follow = shouldFollow(this.follow, this.#window, this.#itemCount, this.timeCursor);
				this.requestUpdate();
				// Wait for lit to commit the grown items into the virtualizer before scrolling, so scrollToIndex(n-1) targets
				// a row that now exists (a bare microtask can run before the commit).
				if (follow) void this.updateComplete.then(() => this.scrollToEnd());
			}) ?? null;
	}

	/** Scroll so the last row is visible. Exposed for the live-follow tail and callers that jump to the newest row. */
	scrollToEnd(): void {
		const n = this.source?.count() ?? 0;
		if (n > 0) this.#virt.value?.scrollToIndex(n - 1, "end");
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

	#onVisibility = (e: VisibilityChangedEvent): void => {
		this.#window = visibleWindow(e.first, e.last);
		if (this.source && e.last >= e.first) void this.source.ensureRange(e.first, e.last + 1);
		this.requestUpdate(); // reposition the rail thumb and glyphs
	};

	#onScrollTo = (e: Event): void => {
		this.#virt.value?.scrollToIndex((e as CustomEvent<{ index: number }>).detail.index, "start");
	};

	render(): TemplateResult {
		const total = this.source?.count() ?? 0;
		const rail = html`<shu-scrollbar .total=${total} .window=${this.#window} .markers=${(this.source?.markers() ?? []) as TScrollMarker[]}></shu-scrollbar>`;
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
