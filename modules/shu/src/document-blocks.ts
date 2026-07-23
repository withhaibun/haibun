/**
 * Turn the run document's generated HTML into a list of self-contained blocks, so the document column can virtualize them
 * (render only the visible window) instead of holding the whole run as one live innerHTML blob. `generateDocumentMarkdown`
 * already emits one top-level element per event (a header, a step line, a prose block, or an artifact placeholder), so a
 * split is exact; `finalizeBlocks` then does what the old imperative post-process + thumbnail grouping did, but as a pure
 * transform over block HTML strings: fill each artifact placeholder from a resolver, add the `doc-row` classes, and
 * collapse a run of consecutive image thumbnails into one wrapping `.thumb-row` strip. Everything here is pure and DOM-only
 * through a detached `<template>`, so it is testable without a live column and never touches the page.
 */

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

/** True when a finalized block is a single image thumbnail (an artifact frame carrying the `thumb` class). */
function isThumb(blockHtml: string): boolean {
	return !!parse(blockHtml).content.firstElementChild?.querySelector("shu-artifact-frame.thumb");
}

/** Fill artifact placeholders, add the reader classes, and group consecutive thumbnails — the pure equivalent of the old
 *  `postProcessElements` (artifact filling + classes) plus `groupThumbnailRows`. Product-view embedding stays in the
 *  column (it needs live event products and a mounted element); it is not a block-HTML concern. */
export function finalizeBlocks(blocks: TDocBlock[], resolveArtifact: TArtifactResolver): TDocBlock[] {
	const filled = blocks
		.map((b) => {
			const tpl = parse(b.html);
			const el = tpl.content.firstElementChild;
			if (!el) return null;
			// Fill artifact placeholders from their ids (feature-artifacts carries data-ids, standalone-artifact data-id).
			for (const holder of Array.from(el.matches(".feature-artifacts, .standalone-artifact") ? [el] : el.querySelectorAll(".feature-artifacts, .standalone-artifact"))) {
				const ids = (holder.getAttribute("data-ids") || holder.getAttribute("data-id") || "").split(",").filter(Boolean);
				holder.innerHTML = ids.map((id) => resolveArtifact(id)).join("");
			}
			// The reader classes the old post-process added: every content block is a clickable doc-row; log rows carry their
			// nesting/connector state from data attributes.
			if (el.matches(".header-block, .prose-block, .log-row")) el.classList.add("doc-row");
			if (el.classList.contains("log-row")) {
				if (el.getAttribute("data-nested") === "true") el.classList.add("nested");
				if (el.getAttribute("data-show-symbol") === "true") el.classList.add("show-connector");
			}
			return { html: el.outerHTML, id: b.id, rawTime: b.rawTime };
		})
		.filter((b): b is TDocBlock => b !== null);

	// Collapse consecutive thumbnails into one `.thumb-row` strip so per-step screenshots wrap into a horizontal row
	// instead of stacking; a run ends at the next non-thumbnail block.
	const out: TDocBlock[] = [];
	let run: TDocBlock[] = [];
	const flush = () => {
		if (run.length === 0) return;
		if (run.length === 1) out.push(run[0]);
		else out.push({ html: `<div class="thumb-row">${run.map((r) => r.html).join("")}</div>`, id: run[0].id, rawTime: run[0].rawTime });
		run = [];
	};
	for (const b of filled) {
		if (isThumb(b.html)) run.push(b);
		else {
			flush();
			out.push(b);
		}
	}
	flush();
	return out;
}
