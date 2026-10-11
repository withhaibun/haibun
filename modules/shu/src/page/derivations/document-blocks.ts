/**
 * Splits the generated HTML of actuality's document into self-contained blocks. The document column virtualizes the
 * blocks and renders only the visible window, instead of holding the whole document as one innerHTML string.
 * `generateDocumentMarkdown` emits one top-level element per event: a header, a step line, a prose block or an artifact
 * placeholder. A split by top-level element is therefore exact. `finalizeBlocks` transforms the block HTML strings. It
 * fills each artifact placeholder from a resolver, adds the `doc-row` classes, and wraps each sequence of consecutive
 * image thumbnails in one `.thumb-row` strip. The functions parse through a detached `<template>` and don't modify the
 * page, so a test runs them without a live column.
 */
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { artifactOf } from "@haibun/core/lib/run-artifact.js";
import type { TArtifactEvent } from "@haibun/core/schema/protocol.js";

/** One document block: its final HTML, the event id it came from, and its raw time. Jump-to and product embedding read
 *  the id. Time-cursor dimming reads the raw time, which is the offset from the column's start. A spacer has an empty
 *  `id` and a zero `rawTime`. A thumbnail strip carries the `id` and `rawTime` of its first block. */
export type TDocBlock = { html: string; id: string; rawTime: number };

/** Resolves one id from an artifact placeholder's `data-id` or `data-ids` to its rendered `<shu-artifact-frame>` HTML.
 *  Returns "" for an unknown id or an artifact that doesn't render. The column supplies the resolver from its event log,
 *  and a test supplies a stub. */
export type TArtifactResolver = (id: string) => string;

const parse = (html: string): HTMLTemplateElement => {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	return tpl;
};

const attrOf = (el: Element, name: string): string => el.getAttribute(name) ?? el.querySelector(`[${name}]`)?.getAttribute(name) ?? "";

/** Returns a block's text content. */
export const blockText = (block: TDocBlock): string => parse(block.html).content.textContent?.trim() ?? "";

/** Splits generated document HTML into one block per top-level element, in order. */
export function splitDocumentBlocks(html: string): TDocBlock[] {
	const blocks: TDocBlock[] = [];
	for (const el of Array.from(parse(html).content.children)) {
		blocks.push({ html: el.outerHTML, id: attrOf(el, "data-id"), rawTime: parseFloat(attrOf(el, "data-raw-time")) || 0 });
	}
	return blocks;
}

// The block selectors: the step-like rows that get the `doc-row` class, and the artifact placeholder holders.
const STEP_ROW_SELECTOR = ".header-block, .prose-block, .log-row";
const ARTIFACT_HOLDER_SELECTOR = ".feature-artifacts, .standalone-artifact";

/** Returns the thumbnail frames of a filled block where the block holds at least one frame and every frame carries the
 *  `thumb` class. Those frames render as grid tiles. Returns an empty list for any other block. A block that mixes a
 *  thumbnail with another artifact frame keeps its own layout. A step that saved an image and a json file produces such
 *  a block. */
function thumbFrames(blockEl: Element): Element[] {
	const frames = Array.from(blockEl.querySelectorAll("shu-artifact-frame"));
	return frames.length > 0 && frames.every((f) => f.classList.contains("thumb")) ? frames : [];
}

/** Fills artifact placeholders, drops artifact blocks that render empty, adds the reader classes, and groups
 *  consecutive thumbnails. `frameOrdinalPrefix` names the page of actuality the blocks are from, and is empty for a
 *  document of one page. The column embeds product views, since an embedded view reads live event products and a mounted
 *  element. */
export function finalizeBlocks(blocks: TDocBlock[], resolveArtifact: TArtifactResolver, frameOrdinalPrefix: string): TDocBlock[] {
	type TFilled = { el: Element; id: string; rawTime: number };
	const filled = blocks
		.map((b): TFilled | null => {
			const tpl = parse(b.html);
			const el = tpl.content.firstElementChild;
			if (!el) return null;
			// Fills artifact placeholders from their ids. A feature-artifacts holder carries data-ids, and a standalone-artifact holder carries data-id.
			for (const holder of Array.from(el.matches(ARTIFACT_HOLDER_SELECTOR) ? [el] : el.querySelectorAll(ARTIFACT_HOLDER_SELECTOR))) {
				const ids = (holder.getAttribute("data-ids") || holder.getAttribute("data-id") || "").split(",").filter(Boolean);
				holder.innerHTML = ids.map((id) => resolveArtifact(id)).join("");
			}
			// An artifact block whose every artifact renders "" is empty, as for a dispatch trace or an unresolvable id. The block
			// is dropped, since it would take a virtualized row and split a sequence of screenshots into stacked frames.
			if (el.matches(ARTIFACT_HOLDER_SELECTOR) && el.childElementCount === 0 && !el.textContent?.trim()) return null;
			// The reader classes: every header, prose and log block is a clickable doc-row. A log row gets its `nested` and
			// `show-connector` classes from data attributes.
			if (el.matches(STEP_ROW_SELECTOR)) el.classList.add("doc-row");
			if (el.classList.contains("log-row")) {
				if (el.getAttribute("data-nested") === "true") el.classList.add("nested");
				if (el.getAttribute("data-show-symbol") === "true") el.classList.add("show-connector");
			}
			return { el, id: b.id, rawTime: b.rawTime };
		})
		.filter((b): b is TFilled => b !== null);

	// Collects each sequence of consecutive thumbnail blocks into one `.thumb-row` grid whose children are the frames. The
	// frames are taken out of their placeholder holders, since a holder as the grid child would nest a step's frames in one
	// cell. Each step's screenshots render as equal tiles across the column width. A lone thumbnail is wrapped too, as a
	// single tile. A sequence ends at the next non-thumbnail block, so thumbnails separated by a step don't share a row.
	// Each frame is stamped with its ordinal among these blocks, under the caller's prefix. The document generates one page
	// of actuality at a time, and the prefix names the page. ←/→ navigation reads the ordinal, since under virtualization a
	// frame's off-window siblings aren't in the DOM. The column sets each frame's data-step-id when it renders the artifact.
	const out: TDocBlock[] = [];
	let run: { frames: Element[]; id: string; rawTime: number }[] = [];
	let ordinal = 0;
	const flush = () => {
		const head = run[0];
		if (!head) return;
		const html = run.flatMap((r) => r.frames.map((f) => f.outerHTML)).join("");
		out.push({ html: `<div class="thumb-row">${html}</div>`, id: head.id, rawTime: head.rawTime });
		run = [];
	};
	for (const b of filled) {
		const frames = thumbFrames(b.el);
		if (frames.length > 0) {
			for (const f of frames) f.setAttribute("data-frame-ordinal", `${frameOrdinalPrefix}${ordinal++}`);
			run.push({ frames, id: b.id, rawTime: b.rawTime });
		} else {
			flush();
			out.push({ html: b.el.outerHTML, id: b.id, rawTime: b.rawTime });
		}
	}
	flush();
	return out;
}

/** Returns the index of the block that carries the heading a link names, or -1 when this document doesn't contain that
 *  heading. The document build stamps the heading's name on its block through headingAnchor. That name is the only
 *  anchor a feature author can write, since block ids are assigned during actuality. */
export function blockIndexForHeading(blocks: readonly TDocBlock[], anchor: string): number {
	if (anchor === "") return -1;
	return blocks.findIndex((b) => b.html.includes(`data-heading="${anchor}"`));
}

/** Assigns the blocks generated for a sequence of events to the event each came from, in order. A block with an id is
 *  assigned to the first event that carries its id, from the event last matched onward. A step's start and its later
 *  end carry the same id, so the block is assigned to the start. A spacer or any other block without an id is assigned
 *  to the event last matched. A block whose id the later events don't carry is also assigned to the event last matched.
 *  Blocks before the first match are assigned to the first event. The document renders one row per event of actuality,
 *  so each event holds the blocks it produced. */
export function blocksByEvent(events: readonly { id?: unknown }[], blocks: readonly TDocBlock[]): TDocBlock[][] {
	const out: TDocBlock[][] = events.map(() => []);
	if (events.length === 0) return out;
	let k = 0;
	for (const b of blocks) {
		if (b.id) {
			for (let j = k; j < events.length; j++) {
				if (String(itemAt(events, j).id ?? "") === b.id) {
					k = j;
					break;
				}
			}
		}
		itemAt(out, k).push(b);
	}
	return out;
}

/** Whether an artifact event is of `kind`, narrowing it to that kind's event. */
export const isArtifactOf = <K extends TArtifactEvent["artifactType"]>(artifact: TArtifactEvent, kind: K): artifact is Extract<TArtifactEvent, { artifactType: K }> =>
	artifactOf(artifact).kind === kind;
