// @vitest-environment jsdom
/**
 * splitDocumentBlocks + finalizeBlocks: the pure transform that lets the run document virtualize. Verifies the split is
 * one block per top-level element with its id/time, that finalize fills artifacts, adds the reader classes, and collapses
 * consecutive thumbnails into a strip while leaving lone thumbnails and thumbnail runs broken by other content alone.
 */
import { describe, it, expect } from "vitest";
import { splitDocumentBlocks, finalizeBlocks, currentBlockIndex, blockIndexForHeading, blockTimeClass, withHeadingAnchors, type TArtifactResolver, type TDocBlock } from "./document-blocks.js";

const thumb = (id: string): string => `<shu-artifact-frame class="thumb"><img src="${id}.png" /></shu-artifact-frame>`;
const resolver: TArtifactResolver = (id) => (id.startsWith("img") ? thumb(id) : `<shu-artifact-frame><pre>${id}</pre></shu-artifact-frame>`);

describe("splitDocumentBlocks", () => {
	it("splits one block per top-level element, in order, with its id and raw time", () => {
		const html = `<div class="header-block" data-id="h" data-raw-time="1.5"><h1>Feature</h1></div><div class="log-row" data-id="s" data-raw-time="2">step</div>`;
		const blocks = splitDocumentBlocks(html);
		expect(blocks).toHaveLength(2);
		expect(blocks[0].id).toBe("h");
		expect(blocks[0].rawTime).toBe(1.5);
		expect(blocks[1].id).toBe("s");
		expect(blocks[1].rawTime).toBe(2);
	});
	it("reads a data-id / data-raw-time carried on a descendant, not only the top element", () => {
		const [b] = splitDocumentBlocks(`<div class="wrap"><div data-id="x" data-raw-time="3">y</div></div>`);
		expect(b.id).toBe("x");
		expect(b.rawTime).toBe(3);
	});
	it("gives spacers an empty id and zero time", () => {
		const [b] = splitDocumentBlocks(`<div class="h-1"></div>`);
		expect(b.id).toBe("");
		expect(b.rawTime).toBe(0);
	});
});

describe("finalizeBlocks", () => {
	it("fills a standalone artifact placeholder from the resolver", () => {
		const blocks = splitDocumentBlocks(`<div class="standalone-artifact" data-id="doc1"></div>`);
		const [b] = finalizeBlocks(blocks, resolver);
		expect(b.html).toContain("<pre>doc1</pre>");
	});
	it("fills a feature-artifacts placeholder for each of its data-ids", () => {
		const blocks = splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,img2"></div>`);
		const [b] = finalizeBlocks(blocks, resolver);
		expect(b.html).toContain("img1.png");
		expect(b.html).toContain("img2.png");
	});
	it("adds the doc-row class to header, prose, and log blocks", () => {
		const blocks = splitDocumentBlocks(
			`<div class="header-block" data-id="h"><h1>x</h1></div><div class="prose-block" data-id="p">x</div><div class="log-row" data-id="l">x</div>`,
		);
		for (const b of finalizeBlocks(blocks, resolver)) expect(b.html).toContain("doc-row");
	});
	it("carries a log row's nesting and connector state onto its classes", () => {
		const blocks = splitDocumentBlocks(`<div class="log-row" data-id="l" data-nested="true" data-show-symbol="true">x</div>`);
		const [b] = finalizeBlocks(blocks, resolver);
		expect(b.html).toContain("nested");
		expect(b.html).toContain("show-connector");
	});
	it("collapses consecutive thumbnails into one thumb-row strip whose grid children are the FRAMES, not their holders", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="feature-artifacts" data-ids="img2"></div><div class="feature-artifacts" data-ids="img3"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(1);
		const tpl = document.createElement("template");
		tpl.innerHTML = out[0].html;
		const row = tpl.content.firstElementChild as Element;
		expect(row.className).toBe("thumb-row");
		// A holder as the grid child would nest a step's frames into ONE cell, wrecking the flow — every child must be a frame.
		expect(Array.from(row.children).map((c) => c.tagName.toLowerCase())).toEqual(["shu-artifact-frame", "shu-artifact-frame", "shu-artifact-frame"]);
	});
	it("spreads a multi-artifact holder (one step, several screenshots) into one tile per frame", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,img2"></div>`), resolver);
		expect(out).toHaveLength(1);
		expect((out[0].html.match(/<shu-artifact-frame/g) ?? []).length).toBe(2);
		expect(out[0].html.startsWith('<div class="thumb-row">')).toBe(true);
	});
	it("wraps even a lone thumbnail in a thumb-row so it flows as a grid tile", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1"></div>`), resolver);
		expect(out).toHaveLength(1);
		expect(out[0].html).toContain("thumb-row");
	});
	it("stamps each frame with the nearest preceding step's id and label, for the expanded view's caption and cursor", () => {
		const html = `<div class="log-row" data-id="0.1.2" data-raw-time="5">take a screenshot</div><div class="feature-artifacts" data-ids="img1,img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(2);
		const tpl = document.createElement("template");
		tpl.innerHTML = out[1].html;
		for (const f of Array.from(tpl.content.querySelectorAll("shu-artifact-frame"))) {
			expect(f.getAttribute("data-step-id")).toBe("0.1.2");
			expect(f.getAttribute("data-step-label")).toBe("take a screenshot");
		}
	});
	it("does not merge thumbnails separated by a non-thumbnail block", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="log-row" data-id="s">step</div><div class="feature-artifacts" data-ids="img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(3); // thumb-row(img1), step, thumb-row(img2) — separate rows, never merged across the step
		expect(out.some((b) => b.html.includes("img1.png") && b.html.includes("img2.png"))).toBe(false);
	});
	it("keeps a non-image artifact (json/html/file) out of a thumbnail strip", () => {
		const html = `<div class="standalone-artifact" data-id="doc1"></div><div class="feature-artifacts" data-ids="img1"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(2); // the json frame is not a thumb, so it does not group with the image
	});
	it("leaves a holder mixing a thumbnail with another artifact intact (its own layout, not a strip)", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1,doc1"></div>`), resolver);
		expect(out).toHaveLength(1);
		expect(out[0].html).not.toContain("thumb-row");
		expect(out[0].html).toContain("feature-artifacts");
	});
	it("drops an artifact block that renders nothing, so it cannot split a run of screenshots", () => {
		// A dispatch trace (or any artifact resolving to "") sat between two screenshots as an invisible block — the run
		// broke there and every tile stacked alone instead of flowing. Empty artifact blocks must not exist at all.
		const silent: TArtifactResolver = (id) => (id.startsWith("img") ? thumb(id) : "");
		const html = `<div class="standalone-artifact" data-id="img1"></div><div class="standalone-artifact" data-id="dispatch.1"></div><div class="standalone-artifact" data-id="img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), silent);
		expect(out).toHaveLength(1); // one strip: img1 + img2, the dispatch block gone
		expect((out[0].html.match(/<shu-artifact-frame/g) ?? []).length).toBe(2);
		expect(out[0].html).toContain("thumb-row");
	});
});

const b = (id: string, rawTime: number): TDocBlock => ({ html: `<div class="log-row" data-id="${id}">x</div>`, id, rawTime });

describe("withHeadingAnchors", () => {
	// A prose block's own markdown headings get the same link-by-name handle the scenario headings carry, so a feature
	// whose introduction says "skip to [the contents](#contents)" can land on its own "## Contents" heading.
	it("stamps a rendered markdown heading with its name as an anchor", async () => {
		const { default: MarkdownIt } = await import("markdown-it");
		const md = new MarkdownIt();
		withHeadingAnchors(md);
		expect(md.render("## Contents")).toContain('data-heading="contents"');
		expect(md.render("## The graph and its views")).toContain('data-heading="the-graph-and-its-views"');
	});
});

describe("blockIndexForHeading", () => {
	// A feature that lists its own scenarios links to them by name. The name is stamped on the heading's block when the
	// document is built, and it is the only handle the author has: block ids are assigned while the run happens.
	const heading = (anchor: string, rawTime: number): TDocBlock => ({ html: `<div class="header-block" data-heading="${anchor}"><h2>x</h2></div>`, id: "", rawTime });
	const blocks = [b("intro", 0), heading("4-the-authority-issues-the-permit", 10), b("body", 20), heading("9-the-authority-revokes-the-permit", 30)];

	it("finds the block carrying the heading a link names", () => {
		expect(blockIndexForHeading(blocks, "9-the-authority-revokes-the-permit")).toBe(3);
	});

	it("finds nothing for a link this document has no heading for, so such a link is left alone", () => {
		expect(blockIndexForHeading(blocks, "Principal"), "a link out of the document, not into it").toBe(-1);
		expect(blockIndexForHeading(blocks, ""), "and an empty target names nothing").toBe(-1);
	});

	it("does not take a heading whose name merely starts the same way", () => {
		expect(blockIndexForHeading(blocks, "4-the-authority")).toBe(-1);
	});
});

describe("currentBlockIndex", () => {
	const blocks = [b("a", 0), { html: "<div class='h-1'></div>", id: "", rawTime: 0 }, b("c", 10), b("d", 20)];
	it("returns -1 when there is no cursor", () => {
		expect(currentBlockIndex(blocks, 100, null)).toBe(-1);
	});
	it("picks the block with the greatest instant at or before the cursor", () => {
		expect(currentBlockIndex(blocks, 100, 115)).toBe(2); // start 100: a@100, c@110, d@120 -> cursor 115 lands on c
	});
	it("lands on the last block when the cursor is at the live edge", () => {
		expect(currentBlockIndex(blocks, 100, 120)).toBe(3);
	});
	it("skips spacers (no id) and out-of-order times", () => {
		const ooo = [b("a", 0), b("b", 30), b("c", 10)]; // b appended before c in time
		expect(currentBlockIndex(ooo, 0, 15)).toBe(2); // greatest <= 15 is c@10, not b@30
	});
});

describe("blockTimeClass", () => {
	const past = b("a", 0),
		cur = b("c", 10),
		fut = b("d", 20);
	const startTime = 100,
		cursor = 110;
	const currentIdx = currentBlockIndex([past, cur, fut], startTime, cursor);
	it("dims a block recorded after the cursor as future", () => {
		expect(blockTimeClass(fut, 2, startTime, cursor, currentIdx)).toBe("future");
	});
	it("marks the cursor's block current", () => {
		expect(blockTimeClass(cur, 1, startTime, cursor, currentIdx)).toBe("current");
	});
	it("leaves a past, non-current block unclassed", () => {
		expect(blockTimeClass(past, 0, startTime, cursor, currentIdx)).toBe("");
	});
	it("classes nothing when there is no cursor or the block is a spacer", () => {
		expect(blockTimeClass(fut, 2, startTime, null, -1)).toBe("");
		expect(blockTimeClass({ html: "<div class='h-1'></div>", id: "", rawTime: 0 }, 0, startTime, cursor, currentIdx)).toBe("");
	});
});
