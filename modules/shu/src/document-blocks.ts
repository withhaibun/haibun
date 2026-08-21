/**
 * Turn the run document's generated HTML into a list of self-contained blocks, so the document column can virtualize them
 * (render only the visible window) instead of holding the whole run as one live innerHTML blob. `generateDocumentMarkdown`
 * already emits one top-level element per event (a header, a step line, a prose block, or an artifact placeholder), so a
 * split is exact; `finalizeBlocks` then does what the old imperative post-process + thumbnail grouping did, but as a pure
 * transform over block HTML strings: fill each artifact placeholder from a resolver, add the `doc-row` classes, and
 * collapse a run of consecutive image thumbnails into one wrapping `.thumb-row` strip. Everything here is pure and DOM-only
 * through a detached `<template>`, so it is testable without a live column and never touches the page.
 */
import { headingAnchor } from "@haibun/core/lib/document-content.js";

/** One document block: its final HTML, the event id it came from (for jump-to and product embedding), and the raw time
 *  (offset from the column's global start) for time-cursor dimming. `id`/`rawTime` are empty/0 for spacers and strips. */
export type TDocBlock = { html: string; id: string; rawTime: number };

/** Resolve an artifact placeholder's `data-id(s)` to its rendered HTML (an `<shu-artifact-frame>…`), or "" if unknown.
 *  The column supplies this from its event log; a test supplies a stub. */
export type TArtifactResolver = (id: string) => string;

const parse = (html: string): HTMLTemplateElement => {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	return tpl;
};

const attrOf = (el: Element, name: string): string => el.getAttribute(name) ?? el.querySelector(`[${name}]`)?.getAttribute(name) ?? "";

/** Split generated document HTML into one block per top-level element, in order. */
export function splitDocumentBlocks(html: string): TDocBlock[] {
	const blocks: TDocBlock[] = [];
	for (const el of Array.from(parse(html).content.children)) {
		blocks.push({ html: el.outerHTML, id: attrOf(el, "data-id"), rawTime: parseFloat(attrOf(el, "data-raw-time")) || 0 });
	}
	return blocks;
}

// The block taxonomy, in one place: the step-like rows a thumbnail belongs to, and the artifact placeholder holders.
const STEP_ROW_SELECTOR = ".header-block, .prose-block, .log-row";
const ARTIFACT_HOLDER_SELECTOR = ".feature-artifacts, .standalone-artifact";

/** The thumbnail frames of a filled block, when the block is PURELY thumbnails (every frame in it carries the `thumb`
 *  class and there is at least one) — those flow as grid tiles. A block mixing a thumbnail with another artifact frame
 *  (a step that saved an image and a json) keeps its own layout. */
function thumbFrames(blockEl: Element): Element[] {
	const frames = Array.from(blockEl.querySelectorAll("shu-artifact-frame"));
	return frames.length > 0 && frames.every((f) => f.classList.contains("thumb")) ? frames : [];
}

/** Fill artifact placeholders, add the reader classes, and group consecutive thumbnails — the pure equivalent of what the
 *  column's imperative post-process and thumbnail grouping used to do (artifact filling, reader classes, thumbnail strips).
 *  Product-view embedding stays in the
 *  column (it needs live event products and a mounted element); it is not a block-HTML concern. */
export function finalizeBlocks(blocks: TDocBlock[], resolveArtifact: TArtifactResolver): TDocBlock[] {
	type TFilled = { el: Element; id: string; rawTime: number };
	const filled = blocks
		.map((b): TFilled | null => {
			const tpl = parse(b.html);
			const el = tpl.content.firstElementChild;
			if (!el) return null;
			// Fill artifact placeholders from their ids (feature-artifacts carries data-ids, standalone-artifact data-id).
			for (const holder of Array.from(el.matches(ARTIFACT_HOLDER_SELECTOR) ? [el] : el.querySelectorAll(ARTIFACT_HOLDER_SELECTOR))) {
				const ids = (holder.getAttribute("data-ids") || holder.getAttribute("data-id") || "").split(",").filter(Boolean);
				holder.innerHTML = ids.map((id) => resolveArtifact(id)).join("");
			}
			// An artifact block whose every artifact renders "" (a dispatch trace, an unresolvable id) is NOTHING: emitting it
			// would waste a virtualized row and, worse, split a run of screenshots so they stack instead of flowing as tiles.
			if (el.matches(ARTIFACT_HOLDER_SELECTOR) && el.childElementCount === 0 && !el.textContent?.trim()) return null;
			// The reader classes the old post-process added: every content block is a clickable doc-row; log rows carry their
			// nesting/connector state from data attributes.
			if (el.matches(STEP_ROW_SELECTOR)) el.classList.add("doc-row");
			if (el.classList.contains("log-row")) {
				if (el.getAttribute("data-nested") === "true") el.classList.add("nested");
				if (el.getAttribute("data-show-symbol") === "true") el.classList.add("show-connector");
			}
			return { el, id: b.id, rawTime: b.rawTime };
		})
		.filter((b): b is TFilled => b !== null);

	// Collect every run of consecutive thumbnail blocks into one `.thumb-row` grid whose children are the FRAMES themselves
	// (extracted from their placeholder holders — a holder as the grid child would nest a step's several frames into one
	// cell), so per-step screenshots flow as equal tiles that take the column width. A lone thumbnail is wrapped too (a
	// single full-width tile); a run ends at the next non-thumbnail block, so thumbnails split by a step never share a row.
	// Each frame is stamped with the step it belongs to (the nearest preceding step/prose/header block) and its run-wide
	// ordinal — the expanded view's caption, cursor scrub, and ←/→ navigation read these, since under virtualization a
	// frame can neither walk to its step's block nor see its off-window siblings.
	const out: TDocBlock[] = [];
	let run: { frames: Element[]; id: string; rawTime: number }[] = [];
	let step: { id: string; el: Element } | null = null;
	let ordinal = 0;
	const flush = () => {
		if (run.length === 0) return;
		const html = run.flatMap((r) => r.frames.map((f) => f.outerHTML)).join("");
		out.push({ html: `<div class="thumb-row">${html}</div>`, id: run[0].id, rawTime: run[0].rawTime });
		run = [];
	};
	for (const b of filled) {
		const frames = thumbFrames(b.el);
		if (frames.length > 0) {
			for (const f of frames) {
				if (step) {
					f.setAttribute("data-step-id", step.id);
					f.setAttribute("data-step-label", step.el.textContent?.trim() ?? "");
				}
				f.setAttribute("data-frame-ordinal", String(ordinal++));
			}
			run.push({ frames, id: b.id, rawTime: b.rawTime });
		} else {
			flush();
			if (b.el.matches(STEP_ROW_SELECTOR)) step = { id: b.id, el: b.el };
			out.push({ html: b.el.outerHTML, id: b.id, rawTime: b.rawTime });
		}
	}
	flush();
	return out;
}

/** The content block that carries the time cursor: the one with the greatest instant at or before it. Not simply the
 *  last block — events can append out of timestamp order — and spacers/strips (no id) never count. -1 when no cursor. */
/** Stamp every markdown heading the renderer produces with its own name as a link anchor (`data-heading`), the same
 *  handle the run's scenario headings carry: a prose block's "## Contents" becomes reachable as `#contents`. The name
 *  comes through the one anchor rule (core's headingAnchor), so a heading and a link to it can never disagree. */
export function withHeadingAnchors(md: { renderer: { rules: Record<string, unknown>; renderToken(tokens: unknown[], idx: number, options: unknown): string } }): void {
	md.renderer.rules.heading_open = (tokens: Array<{ attrSet(name: string, value: string): void }>, idx: number, options: unknown) => {
		const inline = (tokens as Array<{ type?: string; content?: string }>)[idx + 1];
		if (inline?.type === "inline" && inline.content) tokens[idx].attrSet("data-heading", headingAnchor(inline.content));
		return md.renderer.renderToken(tokens, idx, options);
	};
}

/** Which block carries the heading a link names, or -1 when this document has none. The heading's own name is stamped
 *  on its block when the document is built (headingAnchor), which is the only handle a feature author has: the block
 *  ids beside it are assigned while the run happens. */
export function blockIndexForHeading(blocks: readonly TDocBlock[], anchor: string): number {
	if (anchor === "") return -1;
	return blocks.findIndex((b) => b.html.includes(`data-heading="${anchor}"`));
}

export function currentBlockIndex(blocks: readonly TDocBlock[], startTime: number, cursor: number | null): number {
	if (cursor === null) return -1;
	let idx = -1;
	let best = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		if (!b.id) continue;
		const abs = startTime + b.rawTime;
		if (abs <= cursor && abs > best) {
			best = abs;
			idx = i;
		}
	}
	return idx;
}

/** A block's time-cursor state: "future" (recorded after the cursor, dimmed), "current" (the cursor's row), or "" (past,
 *  or no cursor, or a spacer). The column maps these to its time-sync classes. */
export function blockTimeClass(block: TDocBlock, index: number, startTime: number, cursor: number | null, currentIdx: number): "future" | "current" | "" {
	if (!block.id || cursor === null) return "";
	const abs = startTime + block.rawTime;
	if (abs > cursor) return "future";
	if (index === currentIdx) return "current";
	return "";
}
