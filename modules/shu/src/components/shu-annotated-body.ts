/**
 * shu-annotated-body — a document body read inline with its W3C Web Annotations anchored over the text.
 *
 * A web annotation is a note bound to a specific passage: the point is that the note is shown IN CONTEXT with the
 * passage it concerns, not collected in a list. So an annotatable body (markdown / plain text) renders inline,
 * sanitized to the same privacy stance as the body iframe (no network loads; only `data:` images survive); the
 * Recogito text annotator anchors each stored TextQuoteSelector and highlights it; and each note is shown in a
 * MARGIN RAIL beside the text, its card vertically aligned to its highlight. Hovering or clicking a highlight
 * selects its card and vice-versa. A linking annotation's card carries a "go to" that scrolls to the section it
 * cross-references. Selecting a passage offers an "Annotate" affordance that writes a new note through the same RPC
 * gate as every step-write, showing an optimistic card until the reload brings the stored one.
 *
 * Light DOM (createRenderRoot → this): the annotator's positioned highlight layer and this component's own scoped
 * `<style>` live in one scope, so highlights are styled wherever the component is mounted (including nested in a
 * host shadow root, where the annotator's document-level style injection would not reach).
 *
 * The `.annotated-content` node carries NO lit bindings, so lit creates it once and never re-diffs it — leaving the
 * innerHTML this component sets and the layer the annotator injects intact across re-renders (see lit render pitfalls).
 */
import { html, type TemplateResult, type PropertyValues } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { property, state } from "lit/decorators.js";
import DOMPurify from "dompurify";
import { createTextAnnotator, W3CTextFormat, type TextAnnotator } from "../recogito.js";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { renderContentHtml, BODY_READING_STYLE } from "../util.js";
import { refSanitizeOptions } from "../markdown-refs.js";
import type { TAnnotationDraft } from "../entity-store.js";
import { type AnnotationView, type W3CTextAnnotation, toW3CAnnotations, locateQuoteOffsets } from "../annotation-resolver.js";
import type { TQuoteAnchor } from "@haibun/core/lib/resources.js";
import "./shu-scrollbar.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { TScrollMarker, TWindow } from "../scrollbar-model.js";
import { railMarks, railTotalAndWindow } from "../annotation-rail.js";

/** Characters of surrounding text captured as a selection's prefix/suffix, so a short or repeated quote re-anchors to the right spot. */
/** The ref sanitize allowlist plus inline style, which the annotation gutter's highlight spans carry. */
const STYLED_REF_SANITIZE = { ...refSanitizeOptions, ADD_ATTR: ["style", ...refSanitizeOptions.ADD_ATTR] };

const CONTEXT_CHARS = 32;

/** A pending author action: the passage the user selected, the context that makes it a reliable anchor, and the
 *  selection's position (relative to the layout) so the Annotate affordance floats at the selection. */
type DraftSelection = { exact: string; prefix: string; suffix: string; top: number; left: number };

/** Rail geometry: the fixed margin-column width and the minimum gap kept between stacked cards. */
const RAIL_WIDTH = 240;
const CARD_GAP = 8;
/** Above this body size the inline render (markdown + sanitize + annotator) blocks the thread long enough to warrant
 *  painting a "preparing" indicator first, then rendering a frame later. A smaller body mounts inline with no flash. */
const HEAVY_CONTENT_CHARS = 20000;

/** This component is light DOM (createRenderRoot → this), so lit `static styles` do not apply — all styling ships in a
 *  rendered `<style>` node, which scopes to wherever the element is mounted (including a host shadow root). The `.r6o-*`
 *  positioning rules are sourced from `@recogito/text-annotator`'s spans renderer; the rest is this view's own layout. */
const ANNOTATED_BODY_STYLE = `
	.r6o-annotatable { position: relative; -webkit-tap-highlight-color: transparent; }
	/* The annotator makes the content focusable for keyboard nav; suppress the focus outline so the reading area shows no border. */
	.r6o-annotatable:focus, .r6o-annotatable:focus-visible { outline: none; }
	.r6o-span-highlight-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; mix-blend-mode: multiply; pointer-events: none; overflow: hidden; user-select: none; -webkit-user-select: none; z-index: 1; }
	.r6o-span-highlight-layer.hidden { display: none; }
	.r6o-span-highlight-layer .r6o-annotation { position: absolute; display: block; border-style: solid; border-width: 0; box-sizing: content-box; background: var(--shu-accent-soft, rgba(0, 128, 255, 0.28)); }
	/* The body is a row: the content in its OWN scroll region, and the glyph rail beside it. The region's native scrollbar
	   is hidden so the rail is the ONLY scroll control — a reader never sees two bars, and the marks line up with the one
	   rail. The body fills the height its host gives it (a flex child of the entity column's content column). */
	shu-annotated-body { display: flex; flex-direction: row; align-items: stretch; flex: 1 1 auto; min-height: 0; gap: var(--shu-space-2); }
	shu-annotated-body .annotated-scroll { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
	shu-annotated-body .annotated-scroll::-webkit-scrollbar { width: 0; height: 0; }
	shu-annotated-body .annotated-layout { display: flex; align-items: flex-start; gap: var(--shu-space-4); position: relative; }
	shu-annotated-body .annotated-content { flex: 1 1 auto; min-width: 0; ${BODY_READING_STYLE} word-break: break-word; }
	shu-annotated-body .annotated-content .r6o-annotation { cursor: pointer; }
	shu-annotated-body .annotation-rail { flex: 0 0 ${RAIL_WIDTH}px; width: ${RAIL_WIDTH}px; position: relative; align-self: stretch; }
	shu-annotated-body .annotation-card { position: absolute; left: 0; width: 100%; box-sizing: border-box; padding: var(--shu-space-2); border: var(--shu-border-w) solid var(--shu-border); border-left: 3px solid var(--shu-accent, #0080ff); border-radius: var(--shu-radius); background: var(--shu-bg-elevated); font-size: var(--shu-font-sm); cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s; }
	shu-annotated-body .annotation-card:hover, shu-annotated-body .annotation-card.selected { box-shadow: 0 1px 6px rgba(0,0,0,0.18); border-left-color: var(--shu-link, #0a58ca); }
	shu-annotated-body .annotation-card-quote { color: var(--shu-fg-muted); font-style: italic; margin-bottom: var(--shu-space-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	shu-annotated-body .annotation-card-body { color: var(--shu-fg); }
	shu-annotated-body .annotation-card-author { color: var(--shu-fg-faded); margin-top: var(--shu-space-1); }
	shu-annotated-body .annotation-card-link { display: inline-block; margin-top: var(--shu-space-1); color: var(--shu-link, #0a58ca); cursor: pointer; }
	shu-annotated-body .annotated-content .quote-flash { background: var(--shu-warn-soft, rgba(255, 196, 0, 0.5)); transition: background 1.2s; }
	/* The annotation glyph rail: the body's only scroll control, a full-height strip beside the scroll region marking each
	   note. Stretches to the body height (it is outside the scroll region, so it stays put as the content scrolls). */
	shu-annotated-body .annotation-glyph-rail { flex: 0 0 auto; align-self: stretch; }
	shu-annotated-body .annotation-preparing { position: absolute; top: 0; left: 0; right: 0; padding: var(--shu-space-3); color: var(--shu-fg-muted); font-style: italic; text-align: center; z-index: 2; }
	/* The authoring affordance floats over the content at the selection (top/left set inline), so it appears at the selection whether or not the document has annotations. */
	shu-annotated-body .annotation-add { position: absolute; margin-top: 2px; padding: 2px var(--shu-space-2); font-size: var(--shu-font-sm); border: var(--shu-border-w) solid var(--shu-accent, #0080ff); border-radius: var(--shu-radius); background: var(--shu-bg-elevated); color: var(--shu-accent, #0080ff); cursor: pointer; z-index: 3; box-shadow: 0 1px 4px rgba(0,0,0,0.2); white-space: nowrap; }
	shu-annotated-body .annotation-compose { position: absolute; margin-top: 2px; z-index: 3; }
	shu-annotated-body .annotation-compose input { width: 240px; box-sizing: border-box; padding: var(--shu-space-1) var(--shu-space-2); border: var(--shu-border-w) solid var(--shu-accent, #0080ff); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); background: var(--shu-bg-elevated); color: var(--shu-fg); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
`;

/** Drop remote-loading URLs so an inline body never phones home — the privacy stance the body iframe's CSP enforces.
 *  Only `data:` (inline) src/href survive; relative/anchor `#` links stay. Registered once per module load. */
let purifyHookInstalled = false;
function installPurifyHook(): void {
	if (purifyHookInstalled) return;
	purifyHookInstalled = true;
	DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
		for (const attr of ["src", "href"] as const) {
			const v = node.getAttribute(attr);
			if (v && !v.startsWith("data:") && !v.startsWith("#")) node.removeAttribute(attr);
		}
	});
}

/** A note card ready to place: the annotation, the top its passage wants (aligned to the highlight), and the top it is
 *  finally drawn at (pushed down so it never covers the card above — see the measured restack in `updated`). */
type PlacedCard = { annotation: AnnotationView; idealTop: number; top: number };

const AnnotatedBodySchema = z.object({});

export class ShuAnnotatedBody extends ShuElement<typeof AnnotatedBodySchema> {
	/** The document body as an as:Document, with any anchored web annotations (their quote, note, author, and links). */
	summarizeForKihan(): TLinkedData | null {
		if (!this.content) return null;
		const annotations = this.annotations.map((a) => ({
			exact: a.exact,
			...(a.body ? { note: a.body } : {}),
			...(a.author ? { author: a.author } : {}),
			...(a.links?.length ? { linksTo: a.links.map((l) => l.exact) } : {}),
		}));
		return {
			"@id": this.sourceId || "view:annotated-body",
			"@type": "as:Document",
			name: this.sourceLabel || "an annotated document body",
			mediaType: this.mediaType,
			content: this.content,
			...(annotations.length ? { annotations } : {}),
		};
	}

	/** Light DOM so the annotator's injected highlight layer and this view's scoped style share one scope. */
	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	@property({ attribute: false }) accessor content = "";
	@property({ attribute: false }) accessor mediaType = "text/plain";
	@property({ attribute: false }) accessor sourceId = "";
	@property({ attribute: false }) accessor sourceLabel = "";
	@property({ attribute: false }) accessor annotations: AnnotationView[] = [];
	@property({ type: Boolean }) accessor show = true;
	/** How this view asks for a note to be written: the host owns the individual, so it owns the write and the re-resolve
	 *  that follows. Null leaves the body read-only (nothing to author against), which is what a host that does not offer
	 *  annotating passes. */
	@property({ attribute: false }) accessor annotate: ((draft: TAnnotationDraft) => Promise<{ ok: true } | { ok: false; error: string }>) | null = null;
	/** A passage to scroll to and flash once the body is mounted — set by a Text Fragment reference into this document.
	 *  Acted on once per distinct quote (tracked by `revealedKey`), so unrelated re-renders do not re-flash it. */
	@property({ attribute: false }) accessor revealTarget: TQuoteAnchor | null = null;

	@state() private accessor placedCards: PlacedCard[] = [];
	@state() private accessor selectedCommentId = "";
	/** False only while a LARGE body is being rendered inline and anchored — that render blocks the thread for seconds, so
	 *  a "preparing" indicator is painted first in place of a blank view. A small body mounts inline with no indicator
	 *  (stays true throughout), so an ordinary annotated note never flashes it. */
	@state() private accessor ready = true;
	/** The scheduled deferred mount's frame handle: set while one is pending, so a re-render in that window does not
	 *  schedule a second, and a disconnect can cancel it before it mounts onto detached content. */
	private pendingMount?: number;
	/** The passage the reader has selected to annotate, once the "Annotate" affordance is offered; null when idle or drafting. */
	@state() private accessor draft: DraftSelection | null = null;
	/** True while the note-input popup for the current draft is open. */
	@state() private accessor drafting = false;
	/** Optimistic annotations just authored here, shown immediately while the write and reload are in flight. Cleared when
	 *  the reloaded `annotations` property arrives (which then carries the real ones). */
	@state() private accessor pending: AnnotationView[] = [];
	/** Count of annotations the annotator anchored to the text (quote located → highlight drawn). Read synchronously from
	 *  the annotator store (which rejects a quote it cannot place), so it reflects what is highlighted, distinct from what
	 *  the graph holds. Surfaced into the DOM so a view or test can confirm the annotation shows over the content. */
	@state() private accessor anchoredCount = 0;

	private annotator?: TextAnnotator<W3CTextAnnotation>;
	/** The last revealTarget acted on, keyed by its quote fields. */
	private revealedKey = "";
	private mountedSignature = "";
	private resizeObserver?: ResizeObserver;
	/** Set when cards are (re)placed; cleared by the measured restack. Gates the restack so its re-render doesn't loop. */
	private needsRestack = false;

	/** The annotation glyph rail: a fixed strip beside the scrolling document that marks where each annotation is, so a
	 *  reader jumps between notes in a long file. It rides the scroll ANCESTOR (the annotated body is light DOM inside a
	 *  host whose overflow scrolls), tracked in that ancestor's pixel space. */
	#scrollEl: HTMLElement | null = null;
	#railMarkers: TScrollMarker[] = [];
	#railTotal = 0;
	#railWindow: TWindow = { first: 0, visible: 0 };
	#onScroll = (): void => this.#syncRailWindow();

	constructor() {
		super(AnnotatedBodySchema, {});
		installPurifyHook();
	}

	protected override onConnected(): void {
		if (typeof ResizeObserver === "function") {
			this.resizeObserver = new ResizeObserver(() => this.placeCards());
			this.autoTeardown(() => this.resizeObserver?.disconnect());
		}
		// Authoring: a text selection inside the body offers an "Annotate" affordance; mouseup is when the selection settles.
		this.autoListen(this, "mouseup", () => this.onSelectionSettled());
		// The glyph rail seeks the scroll ancestor; it emits scroll-to-index (a pixel here) which bubbles from the child rail.
		this.autoListen(this, SCROLL_TO_INDEX, (e) => this.#onRailSeek(e as CustomEvent<{ index: number }>));
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => this.#attachScroll());
	}

	/** The body owns its content scroll (`.annotated-scroll`, native bar hidden); track it so the glyph rail's window and
	 *  marks follow the reader, and the rail is the only scroll control. */
	#attachScroll(): void {
		if (!this.isConnected) return; // the rAF can fire after a disconnect; syncing would requestUpdate a detached element
		this.#scrollEl = this.renderRoot.querySelector<HTMLElement>(".annotated-scroll");
		if (!this.#scrollEl) return;
		this.#scrollEl.addEventListener("scroll", this.#onScroll, { passive: true });
		this.autoTeardown(() => this.#scrollEl?.removeEventListener("scroll", this.#onScroll));
		this.#syncRailWindow();
		this.placeCards(); // recompute marks now the scroll element is known (an earlier placeCards ran with none)
	}

	/** Update the rail's total + window from the scroll container (cheap read on every scroll). */
	#syncRailWindow(): void {
		if (!this.#scrollEl) return;
		const { total, window } = railTotalAndWindow(this.#scrollEl);
		this.#railTotal = total;
		this.#railWindow = window;
		this.requestUpdate();
	}

	/** A rail mark or drag emits a pixel down the scroll content; scroll the body's own region there. */
	#onRailSeek(e: CustomEvent<{ index: number }>): void {
		if (this.#scrollEl) this.#scrollEl.scrollTop = e.detail.index;
	}

	protected override onDisconnected(): void {
		this.cancelDeferredMount();
		this.teardownAnnotator();
	}

	private cancelDeferredMount(): void {
		if (this.pendingMount === undefined) return;
		cancelAnimationFrame(this.pendingMount);
		this.pendingMount = undefined;
	}

	/** What the mounted content is keyed by: re-mount when the source, its media type, or the text itself changes. */
	private contentSignature(): string {
		return `${this.sourceId} ${this.mediaType} ${this.content}`;
	}

	private teardownAnnotator(): void {
		this.annotator?.destroy();
		this.annotator = undefined;
		this.mountedSignature = "";
	}

	/** The sanitized inline HTML for the body: markdown/plain rendered to HTML, then purged of scripts and remote loads.
	 *  Markdown renders with its in-app references live. A text shown inline is read here, so a `#Type:id` link in it
	 *  opens that individual in a column; as a plain anchor it would navigate the page to a hash the app cannot read. */
	private sanitizedHtml(): string {
		return DOMPurify.sanitize(renderContentHtml(this.content, this.mediaType), STYLED_REF_SANITIZE);
	}

	private contentEl(): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>(".annotated-content");
	}

	/** Drop `ready` before a LARGE body re-mounts, so the "preparing" indicator paints in place of a blank view while the
	 *  deferred render runs. A small body keeps `ready` and mounts inline in `updated` — no flash. */
	protected override willUpdate(): void {
		if (this.contentSignature() !== this.mountedSignature && this.content.length > HEAVY_CONTENT_CHARS) this.ready = false;
	}

	protected override updated(changed: PropertyValues): void {
		const container = this.contentEl();
		if (!container) return;
		if (this.contentSignature() !== this.mountedSignature) {
			// A different body is being shown: any note optimistically authored against the last one does not belong to it.
			if (this.pending.length > 0) this.pending = [];
			// A large body's render blocks the thread for seconds and lit paints only after this returns, so mounting inline
			// would freeze before the indicator shows. Two frames defer it: a callback runs before its own frame paints, so
			// the second runs with the indicator on screen. The handle follows the pending frame, so a disconnect cancels it.
			if (this.content.length > HEAVY_CONTENT_CHARS) {
				if (this.pendingMount === undefined) this.pendingMount = requestAnimationFrame(() => (this.pendingMount = requestAnimationFrame(() => this.mountBody())));
			} else this.mountBody();
			return;
		}
		if (changed.has("revealTarget")) this.applyReveal();
		if (changed.has("annotations")) {
			// The reload brought the real annotations; drop the optimistic placeholders they replace.
			if (this.pending.length > 0) this.pending = [];
			this.applyAnnotations();
		} else if (changed.has("pending")) {
			this.applyAnnotations();
		}
		if (changed.has("show")) {
			this.annotator?.setVisible(this.show);
			this.placeCards();
		}
		// After cards render at their ideal tops, push any that would cover the card above it below its measured bottom —
		// so several annotations on one line stack instead of overlapping, whatever each note's height is.
		if (this.needsRestack && this.placedCards.length > 0) this.restackCards();
		if (changed.has("drafting") && this.drafting) this.renderRoot.querySelector<HTMLInputElement>('[data-testid="annotation-compose-input"]')?.focus();
	}

	/** Render the body inline and mount the annotator over it — the thread-blocking step, run inline for a small body and
	 *  one painted frame later for a large one (see `updated`). Reads the current content, so a deferred run picks up the
	 *  latest even if the source changed while the frame was pending. */
	private mountBody(): void {
		this.pendingMount = undefined;
		const container = this.contentEl();
		const signature = this.contentSignature();
		if (!container || signature === this.mountedSignature) {
			// Nothing left to render (already mounted, or no content node to mount into): the indicator must not outlive it.
			this.ready = true;
			return;
		}
		this.teardownAnnotator();
		container.innerHTML = this.sanitizedHtml();
		this.annotator = createTextAnnotator<W3CTextAnnotation>(container, {
			adapter: W3CTextFormat(this.sourceId, container),
			annotatingEnabled: false,
		});
		this.annotator.on("clickAnnotation", (a: W3CTextAnnotation) => this.selectCard(String(a.id)));
		this.mountedSignature = signature;
		this.resizeObserver?.observe(container);
		this.applyAnnotations();
		this.ready = true;
		this.applyReveal();
	}

	/** Reveal the requested passage if it has not been revealed yet — after mount, and when the target changes. */
	private applyReveal(): void {
		if (!this.revealTarget) return;
		const key = `${this.revealTarget.exact}\u0000${this.revealTarget.prefix ?? ""}\u0000${this.revealTarget.suffix ?? ""}`;
		if (key === this.revealedKey) return;
		this.revealedKey = key;
		this.revealQuote(this.revealTarget);
	}

	/** Lower each card to below the previous card's measured bottom when its ideal top would overlap, keeping cards ordered
	 *  by their passage and non-overlapping. Re-renders only if a top moved. */
	private restackCards(): void {
		this.needsRestack = false;
		const cardEls = Array.from(this.renderRoot.querySelectorAll<HTMLElement>('[data-testid="annotation-card"]'));
		if (cardEls.length !== this.placedCards.length) return;
		let changed = false;
		let cursor = -Infinity;
		const next = this.placedCards.map((card, i) => {
			const height = cardEls[i].getBoundingClientRect().height;
			const top = Math.max(card.idealTop, cursor);
			cursor = top + height + CARD_GAP;
			if (top !== card.top) changed = true;
			return { ...card, top };
		});
		if (changed) this.placedCards = next;
	}

	private applyAnnotations(): void {
		if (!this.annotator) return;
		const container = this.contentEl();
		const containerText = container?.textContent ?? "";
		// Optimistic (pending) annotations are highlighted too, so an authored note appears anchored at once.
		this.annotator.setAnnotations(toW3CAnnotations([...this.annotations, ...this.pending], this.sourceId, containerText));
		this.annotator.setVisible(this.show);
		this.placeCards();
	}

	/** Position each note card in the rail at its passage's vertical offset, then push overlapping cards down so none
	 *  covers another (a top-sorted stack). The card top is measured from the passage's OWN DOM range — computed from the
	 *  quote, present at any document size — NOT from the annotator's highlight span, which its renderer paints only near
	 *  the viewport (so a passage far down a large document has no span until scrolled to). requestAnimationFrame is
	 *  unavailable in a non-browser (unit) context; there the rail stays empty and the DOM-render assertions do not apply. */
	private placeCards(): void {
		if (typeof requestAnimationFrame !== "function") return;
		requestAnimationFrame(() => {
			const container = this.contentEl();
			if (!container) return;
			const containerText = container.textContent ?? "";
			const layoutTop = this.renderRoot.querySelector<HTMLElement>(".annotated-layout")?.getBoundingClientRect().top ?? 0;
			const raw: PlacedCard[] = [];
			// Rail marks are in the scroll region's pixel space (offset down its content), so a mark sits where the reader
			// scrolls to reach the note; the card idealTop stays in the layout's own space for the margin stack.
			const located: { commentId: string; offset: number; label: string }[] = [];
			const scrollTop = this.#scrollEl?.getBoundingClientRect().top ?? 0;
			const scrollScroll = this.#scrollEl?.scrollTop ?? 0;
			for (const a of [...this.annotations, ...this.pending]) {
				const off = locateQuoteOffsets(containerText, a.exact, a.prefix, a.suffix);
				if (!off) continue; // quote absent from this rendering → no card (the note stays in the graph)
				const range = rangeForOffsets(container, off.start, off.end);
				if (!range) continue;
				const rectTop = range.getBoundingClientRect().top;
				raw.push({ annotation: a, idealTop: rectTop - layoutTop, top: rectTop - layoutTop });
				if (this.#scrollEl) located.push({ commentId: a.commentId, offset: rectTop - scrollTop + scrollScroll, label: a.body || a.exact });
			}
			this.#railMarkers = railMarks(located, "var(--shu-accent, #0080ff)");
			if (this.#scrollEl) this.#syncRailWindow();
			// The count of passages actually located in the text — what is highlighted, distinct from what the graph holds.
			this.anchoredCount = raw.length;
			if (!this.show) {
				this.placedCards = [];
				return;
			}
			// Sort by the passage position and render at the ideal top; the measured restack in `updated` then separates any
			// that overlap (several notes on one line). Ordering by idealTop keeps that restack stable.
			raw.sort((x, y) => x.idealTop - y.idealTop);
			this.needsRestack = true;
			this.placedCards = raw;
		});
	}

	/** Select a note: mark its card and scroll its highlight into view. Fired by a highlight click and a card click alike. */
	private selectCard(commentId: string): void {
		this.selectedCommentId = commentId;
		this.annotator?.scrollIntoView(commentId);
	}

	// --- Authoring: select text → annotate ---

	/** The active selection scoped to this component's root. When mounted in a host shadow root, a user selection lives
	 *  inside that root and `window.getSelection()` retargets it to the shadow host (losing the inner nodes); the shadow
	 *  root's own `getSelection` (supported where shadow DOM is) returns it with the real text nodes. Falls back to the
	 *  window selection at the document top level. */
	private rootSelection(): Selection | null {
		const root = this.getRootNode() as Document | (ShadowRoot & { getSelection?: () => Selection | null });
		if (typeof (root as { getSelection?: unknown }).getSelection === "function") return (root as { getSelection: () => Selection | null }).getSelection();
		return typeof window !== "undefined" ? window.getSelection() : null;
	}

	/** A settled text selection inside the body offers the "Annotate" affordance for that passage. The selection's exact
	 *  text plus surrounding context (prefix/suffix) determine reliably what is being annotated — a short or repeated
	 *  quote still anchors to the right spot. A collapsed or out-of-content selection clears any offered draft. */
	private onSelectionSettled(): void {
		if (this.drafting) return;
		const container = this.contentEl();
		const sel = this.rootSelection();
		if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) {
			this.draft = null;
			return;
		}
		const range = sel.getRangeAt(0);
		if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
			this.draft = null;
			return;
		}
		const exact = sel.toString();
		if (!exact.trim()) {
			this.draft = null;
			return;
		}
		const text = container.textContent ?? "";
		const start = offsetOfPoint(container, range.startContainer, range.startOffset);
		const end = offsetOfPoint(container, range.endContainer, range.endOffset);
		const layout = this.renderRoot.querySelector<HTMLElement>(".annotated-layout")?.getBoundingClientRect();
		const sr = range.getBoundingClientRect();
		this.draft = {
			exact,
			prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
			suffix: text.slice(end, end + CONTEXT_CHARS),
			// Just below the selection's end, relative to the (position: relative) layout, so the affordance floats at it.
			top: sr.bottom - (layout?.top ?? 0),
			left: sr.left - (layout?.left ?? 0),
		};
	}

	/** Hand the drafted note to the host to write — this view shows a body and reports what the reader selected and
	 *  wrote; the host holds the individual (and its entity handle), so the write and the re-resolve are its to make. An
	 *  optimistic card + highlight show at once; the written note arrives as a fresh `annotations` (which clears the
	 *  placeholder), and a failed write drops it. */
	private async createDraft(text: string): Promise<void> {
		const draft = this.draft;
		if (!draft || !text.trim() || !this.sourceLabel || !this.annotate) return;
		this.drafting = false;
		this.draft = null;
		const placeholderId = `pending-${this.sourceId}-${draft.exact}-${text}`;
		this.pending = [...this.pending, { commentId: placeholderId, specificResourceId: "", exact: draft.exact, prefix: draft.prefix, suffix: draft.suffix, body: text }];
		this.rootSelection()?.removeAllRanges();
		const res = await this.annotate({ exact: draft.exact, prefix: draft.prefix, suffix: draft.suffix, text });
		if (!res.ok) this.pending = this.pending.filter((p) => p.commentId !== placeholderId);
	}

	private onDraftKeydown(e: KeyboardEvent): void {
		if (e.key === "Enter") void this.createDraft((e.target as HTMLInputElement).value);
		else if (e.key === "Escape") {
			this.drafting = false;
			this.draft = null;
		}
	}

	/** Land the reader on a quoted passage: find it in the rendered text and scroll it into view with a brief flash.
	 *  Shared by a linking annotation's "go to" and by a Text Fragment reference into this document. */
	private revealQuote(link: TQuoteAnchor): void {
		const container = this.contentEl();
		if (!container) return;
		const offsets = locateQuoteOffsets(container.textContent ?? "", link.exact, link.prefix, link.suffix);
		if (!offsets) return;
		const range = rangeForOffsets(container, offsets.start, offsets.end);
		if (!range) return;
		const mark = document.createElement("span");
		mark.className = "quote-flash";
		try {
			range.surroundContents(mark);
		} catch {
			return; // the range crosses element boundaries — skip the flash, still scroll below
		}
		mark.scrollIntoView({ block: "center", behavior: "smooth" });
		setTimeout(() => {
			const parent = mark.parentNode;
			if (parent) {
				while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
				parent.removeChild(mark);
			}
		}, 1400);
	}

	render(): TemplateResult {
		const cards = this.show ? this.placedCards : [];
		// The rail (gutter) is reserved whenever the gutter is shown, notes or none — the text column's width, and so its
		// wrapping, stay put as notes come and go. The authoring affordance is NOT in the rail: it floats over the content
		// at the selection (see renderAuthoring), so it appears in the same place whether or not the document has annotations.
		return html`
			<style>${ANNOTATED_BODY_STYLE}</style>
			${this.anchoredCount > 0 ? html`<span data-testid="annotation-highlight" hidden></span>` : html``}
			<div class="annotated-scroll"><div class="annotated-layout">
				<div class="annotated-content" data-testid="annotated-content"></div>
				${this.ready ? html`` : html`<div class="annotation-preparing" data-testid="annotation-preparing">Preparing ${this.sourceLabel || "document"}…</div>`}
				${this.renderAuthoring()}
				${
					!this.show
						? html``
						: html`<div class="annotation-rail" data-testid="annotation-rail">
					${cards.map(
						({ annotation: a, top }) => html`<div
							class="annotation-card ${this.selectedCommentId === a.commentId ? "selected" : ""}"
							data-testid="annotation-card"
							data-comment-id=${a.commentId}
							style="top: ${Math.round(top)}px"
							@click=${() => this.selectCard(a.commentId)}
						>
							<div class="annotation-card-quote">“${a.exact}”</div>
							${a.body ? html`<div class="annotation-card-body">${unsafeHTML(DOMPurify.sanitize(renderContentHtml(a.body, "text/markdown"), STYLED_REF_SANITIZE))}</div>` : html``}
							${a.author ? html`<div class="annotation-card-author">${a.author}</div>` : html``}
							${(a.links ?? []).map(
								(link) => html`<span
										class="annotation-card-link"
										data-testid="annotation-card-link"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.revealQuote(link);
										}}
										>→ “${link.exact}”</span
									>`,
							)}
						</div>`,
					)}
					</div>`
				}
				</div></div>
			${
				this.show && this.#scrollEl
					? html`<shu-scrollbar
						class="annotation-glyph-rail"
						data-testid="annotation-glyph-rail"
						.total=${this.#railTotal}
						.window=${this.#railWindow}
						.markers=${this.#railMarkers}
						.showPosition=${false}
					></shu-scrollbar>`
					: html``
			}
			`;
	}

	/** The authoring affordance, floating over the content at the selection: an "Annotate" button once a selection is
	 *  offered, then a note input. Positioned at the selection's own x/y (not in the rail), so it appears in the same place
	 *  whether or not the document already has annotations. Present only when the body knows its individual (sourceLabel). */
	private renderAuthoring(): TemplateResult {
		if (!this.draft || !this.sourceLabel) return html``;
		const pos = `top: ${Math.round(this.draft.top)}px; left: ${Math.round(this.draft.left)}px`;
		if (this.drafting) {
			return html`<div class="annotation-compose" data-testid="annotation-compose" style="${pos}">
				<input type="text" data-testid="annotation-compose-input" placeholder="Add a note…" @keydown=${this.onDraftKeydown} @blur=${() => {
					this.drafting = false;
				}} />
			</div>`;
		}
		return html`<button class="annotation-add" data-testid="annotation-add" style="${pos}" @mousedown=${(e: Event) => {
			e.preventDefault();
			this.drafting = true;
		}}>＋ Annotate</button>`;
	}
}

/** The flat offset (over a container's textContent) of a DOM point (node + offset) — the inverse of rangeForOffsets,
 *  used to turn a live selection's boundaries into the offsets a TextQuoteSelector's prefix/suffix are sliced from. */
function offsetOfPoint(container: HTMLElement, node: Node, offset: number): number {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let pos = 0;
	for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
		if (n === node) return pos + offset;
		pos += n.data.length;
	}
	// A non-text point (element boundary): count text up to it via a range from the container start.
	const r = document.createRange();
	r.setStart(container, 0);
	r.setEnd(node, offset);
	return r.toString().length;
}

/** Map flat text offsets (over a container's textContent) to a DOM Range, walking text nodes to find the boundaries. */
function rangeForOffsets(container: HTMLElement, start: number, end: number): Range | null {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let pos = 0;
	let startNode: Text | null = null;
	let startOffset = 0;
	let endNode: Text | null = null;
	let endOffset = 0;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const len = node.data.length;
		if (!startNode && pos + len > start) {
			startNode = node;
			startOffset = start - pos;
		}
		if (pos + len >= end) {
			endNode = node;
			endOffset = end - pos;
			break;
		}
		pos += len;
	}
	if (!startNode || !endNode) return null;
	const range = document.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	return range;
}

if (!customElements.get("shu-annotated-body")) customElements.define("shu-annotated-body", ShuAnnotatedBody);
