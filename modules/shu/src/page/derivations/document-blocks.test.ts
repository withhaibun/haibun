// @vitest-environment jsdom
/**
 * Tests the pure transforms that let the document column of actuality virtualize its blocks. splitDocumentBlocks returns
 * one block per top-level element with its id and time. finalizeBlocks fills artifacts, adds the reader classes, and
 * wraps each sequence of consecutive thumbnails in one strip. A lone thumbnail gets its own strip, and other content
 * ends a sequence.
 */
import { describe, it, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { splitDocumentBlocks, finalizeBlocks, blocksByEvent, blockIndexForHeading, type TArtifactResolver, type TDocBlock } from "./document-blocks.js";
import { withHeadingAnchors } from "./markdown.js";

/** The prefix of a document that names one page of actuality: none. */
const NO_PAGE = "";

const thumb = (id: string): string => `<shu-artifact-frame class="thumb"><img src="${id}.png" /></shu-artifact-frame>`;
const resolver: TArtifactResolver = (id) => (id.startsWith("img") ? thumb(id) : `<shu-artifact-frame><pre>${id}</pre></shu-artifact-frame>`);

describe("splitDocumentBlocks", () => {
	it("splits one block per top-level element, in order, with its id and raw time", () => {
		const html = `<div class="header-block" data-id="h" data-raw-time="1.5"><h1>Feature</h1></div><div class="log-row" data-id="s" data-raw-time="2">step</div>`;
		const blocks = splitDocumentBlocks(html);
		expect(blocks).toHaveLength(2);
		expect(itemAt(blocks, 0).id).toBe("h");
		expect(itemAt(blocks, 0).rawTime).toBe(1.5);
		expect(itemAt(blocks, 1).id).toBe("s");
		expect(itemAt(blocks, 1).rawTime).toBe(2);
	});
	it("reads a data-id / data-raw-time carried on a descendant, not only the top element", () => {
		const b = itemAt(splitDocumentBlocks(`<div class="wrap"><div data-id="x" data-raw-time="3">y</div></div>`), 0);
		expect(b.id).toBe("x");
		expect(b.rawTime).toBe(3);
	});
	it("gives spacers an empty id and zero time", () => {
		const b = itemAt(splitDocumentBlocks(`<div class="h-1"></div>`), 0);
		expect(b.id).toBe("");
		expect(b.rawTime).toBe(0);
	});
});

describe("finalizeBlocks", () => {
	it("fills a standalone artifact placeholder from the resolver", () => {
		const blocks = splitDocumentBlocks(`<div class="standalone-artifact" data-id="doc1"></div>`);
		const b = itemAt(finalizeBlocks(blocks, resolver, NO_PAGE), 0);
		expect(b.html).toContain("<pre>doc1</pre>");
	});
	it("fills a feature-artifacts placeholder for each of its data-ids", () => {
		const blocks = splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,img2"></div>`);
		const b = itemAt(finalizeBlocks(blocks, resolver, NO_PAGE), 0);
		expect(b.html).toContain("img1.png");
		expect(b.html).toContain("img2.png");
	});
	it("adds the doc-row class to header, prose, and log blocks", () => {
		const blocks = splitDocumentBlocks(
			`<div class="header-block" data-id="h"><h1>x</h1></div><div class="prose-block" data-id="p">x</div><div class="log-row" data-id="l">x</div>`,
		);
		for (const b of finalizeBlocks(blocks, resolver, NO_PAGE)) expect(b.html).toContain("doc-row");
	});
	it("carries a log row's nesting and connector state onto its classes", () => {
		const blocks = splitDocumentBlocks(`<div class="log-row" data-id="l" data-nested="true" data-show-symbol="true">x</div>`);
		const b = itemAt(finalizeBlocks(blocks, resolver, NO_PAGE), 0);
		expect(b.html).toContain("nested");
		expect(b.html).toContain("show-connector");
	});
	it("collapses consecutive thumbnails into one thumb-row strip whose grid children are the frames, not their holders", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="feature-artifacts" data-ids="img2"></div><div class="feature-artifacts" data-ids="img3"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver, NO_PAGE);
		expect(out).toHaveLength(1);
		const tpl = document.createElement("template");
		tpl.innerHTML = itemAt(out, 0).html;
		const row = tpl.content.firstElementChild as Element;
		expect(row.className).toBe("thumb-row");
		// A holder as the grid child would nest a step's frames in one cell, so every child must be a frame.
		expect(Array.from(row.children).map((c) => c.tagName.toLowerCase())).toEqual(["shu-artifact-frame", "shu-artifact-frame", "shu-artifact-frame"]);
	});
	it("spreads a multi-artifact holder (one step, several screenshots) into one tile per frame", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,img2"></div>`), resolver, NO_PAGE);
		expect(out).toHaveLength(1);
		expect((itemAt(out, 0).html.match(/<shu-artifact-frame/g) ?? []).length).toBe(2);
		expect(itemAt(out, 0).html.startsWith('<div class="thumb-row">')).toBe(true);
	});
	it("wraps a lone thumbnail in a thumb-row so it renders as a grid tile", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1"></div>`), resolver, NO_PAGE);
		expect(out).toHaveLength(1);
		expect(itemAt(out, 0).html).toContain("thumb-row");
	});
	it("keeps each frame's data-step-id, and doesn't replace it with the preceding row's id", () => {
		// A screenshot follows another step's row where its own step's row is on the previous page or below the document's log level.
		const named = `<shu-artifact-frame class="thumb" data-step-id="0.1.1"><img src="x.png" /></shu-artifact-frame>`;
		const html = `<div class="log-row" data-id="0.1.2" data-raw-time="5">another step</div><div class="standalone-artifact" data-id="shot"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), () => named, NO_PAGE);
		const tpl = document.createElement("template");
		tpl.innerHTML = itemAt(out, 1).html;
		expect(Array.from(tpl.content.querySelectorAll("shu-artifact-frame")).map((f) => f.getAttribute("data-step-id"))).toEqual(["0.1.1"]);
	});
	it("does not merge thumbnails separated by a non-thumbnail block", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="log-row" data-id="s">step</div><div class="feature-artifacts" data-ids="img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver, NO_PAGE);
		expect(out).toHaveLength(3); // thumb-row(img1), step, thumb-row(img2): the step separates the two strips
		expect(out.some((b) => b.html.includes("img1.png") && b.html.includes("img2.png"))).toBe(false);
	});
	it("keeps a non-image artifact (json/html/file) out of a thumbnail strip", () => {
		const html = `<div class="standalone-artifact" data-id="doc1"></div><div class="feature-artifacts" data-ids="img1"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver, NO_PAGE);
		expect(out).toHaveLength(2); // the json frame is not a thumb, so it does not group with the image
	});
	it("keeps a holder that mixes a thumbnail with another artifact as one block outside a strip", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,doc1"></div>`), resolver, NO_PAGE);
		expect(out).toHaveLength(1);
		expect(itemAt(out, 0).html).not.toContain("thumb-row");
		expect(itemAt(out, 0).html).toContain("feature-artifacts");
	});
	it("drops an artifact block that renders an empty string, so it cannot split a sequence of screenshots", () => {
		// A dispatch trace or any other artifact that resolves to "" would leave an invisible block between two screenshots.
		// That block would end the sequence of tiles, so each tile would stack alone.
		const silent: TArtifactResolver = (id) => (id.startsWith("img") ? thumb(id) : "");
		const html = `<div class="standalone-artifact" data-id="img1"></div><div class="standalone-artifact" data-id="dispatch.1"></div><div class="standalone-artifact" data-id="img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), silent, NO_PAGE);
		expect(out).toHaveLength(1); // one strip holds img1 and img2, and the dispatch block is dropped
		expect((itemAt(out, 0).html.match(/<shu-artifact-frame/g) ?? []).length).toBe(2);
		expect(itemAt(out, 0).html).toContain("thumb-row");
	});
});

const b = (id: string, rawTime: number): TDocBlock => ({ html: `<div class="log-row" data-id="${id}">x</div>`, id, rawTime });

describe("withHeadingAnchors", () => {
	// A prose block's markdown headings carry the same anchor as scenario headings. A link "skip to [the contents](#contents)"
	// in a feature's introduction then targets that feature's own "## Contents" heading.
	it("stamps a rendered markdown heading with its name as an anchor", async () => {
		const { default: MarkdownIt } = await import("markdown-it");
		const md = new MarkdownIt();
		withHeadingAnchors(md);
		expect(md.render("## Contents")).toContain('data-heading="contents"');
		expect(md.render("## The graph and its views")).toContain('data-heading="the-graph-and-its-views"');
	});
});

describe("blockIndexForHeading", () => {
	// A feature that lists its own scenarios links to them by name. The document build stamps the name on the heading's
	// block. The name is the only anchor a feature author can write, since block ids are assigned during actuality.
	const heading = (anchor: string, rawTime: number): TDocBlock => ({ html: `<div class="header-block" data-heading="${anchor}"><h2>x</h2></div>`, id: "", rawTime });
	const blocks = [b("intro", 0), heading("4-the-authority-issues-the-permit", 10), b("body", 20), heading("9-the-authority-revokes-the-permit", 30)];

	it("finds the block carrying the heading a link names", () => {
		expect(blockIndexForHeading(blocks, "9-the-authority-revokes-the-permit")).toBe(3);
	});

	it("returns -1 for a link that doesn't name a heading in this document", () => {
		expect(blockIndexForHeading(blocks, "Principal"), "a link out of the document, not into it").toBe(-1);
		expect(blockIndexForHeading(blocks, ""), "and an empty target doesn't name a heading").toBe(-1);
	});

	it("doesn't match a heading whose name only starts the same way", () => {
		expect(blockIndexForHeading(blocks, "4-the-authority")).toBe(-1);
	});
});

describe("blocksByEvent", () => {
	const block = (id: string, html = `<div data-id="${id}"></div>`): TDocBlock => ({ html, id, rawTime: 0 });
	it("assigns each block to the event whose id it carries, and a spacer to the event before it", () => {
		const events = [{ id: "0.1" }, { id: "0.1" }, { id: "0.2" }];
		const blocks = [block("0.1"), block("", '<div class="h-1"></div>'), block("0.2")];
		expect(blocksByEvent(events, blocks).map((bs) => bs.map((b) => b.id))).toEqual([["0.1", ""], [], ["0.2"]]);
	});
	it("assigns a step's blocks to the first event that carries its id, not to a later event that carries it again", () => {
		const events = [{ id: "0.1" }, { id: "0.1" }]; // one step named twice
		expect(blocksByEvent(events, [block("0.1"), block("0.1")]).map((bs) => bs.length)).toEqual([2, 0]);
	});
	it("assigns a block to the event last matched where the later events don't carry its id, as for a holder filled for an earlier step", () => {
		const events = [{ id: "0.1" }, { id: "0.2" }];
		expect(blocksByEvent(events, [block("0.2"), block("0.1")]).map((bs) => bs.map((b) => b.id))).toEqual([[], ["0.2", "0.1"]]);
	});
	it("assigns blocks before the first block with an id to the first event, and returns an empty list without events", () => {
		expect(blocksByEvent([{ id: "a" }], [block("", "<div></div>")]).map((bs) => bs.length)).toEqual([1]);
		expect(blocksByEvent([], [block("a")])).toEqual([]);
	});
});

describe("finalizeBlocks frame ordinals", () => {
	it("stamps frames in order under the caller's prefix, so a page of actuality names its own frames", () => {
		const resolver: TArtifactResolver = (id) => `<shu-artifact-frame class="thumb"><img src="${id}.png" /></shu-artifact-frame>`;
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="a,b"></div>`), resolver, "3:");
		expect(itemAt(out, 0).html).toContain('data-frame-ordinal="3:0"');
		expect(itemAt(out, 0).html).toContain('data-frame-ordinal="3:1"');
	});
});
