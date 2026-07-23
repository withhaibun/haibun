// @vitest-environment jsdom
/**
 * splitDocumentBlocks + finalizeBlocks: the pure transform that lets the run document virtualize. Verifies the split is
 * one block per top-level element with its id/time, that finalize fills artifacts, adds the reader classes, and collapses
 * consecutive thumbnails into a strip while leaving lone thumbnails and thumbnail runs broken by other content alone.
 */
import { describe, it, expect } from "vitest";
import { splitDocumentBlocks, finalizeBlocks, type TArtifactResolver } from "./document-blocks.js";

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
		const blocks = splitDocumentBlocks(`<div class="header-block" data-id="h"><h1>x</h1></div><div class="prose-block" data-id="p">x</div><div class="log-row" data-id="l">x</div>`);
		for (const b of finalizeBlocks(blocks, resolver)) expect(b.html).toContain("doc-row");
	});
	it("carries a log row's nesting and connector state onto its classes", () => {
		const blocks = splitDocumentBlocks(`<div class="log-row" data-id="l" data-nested="true" data-show-symbol="true">x</div>`);
		const [b] = finalizeBlocks(blocks, resolver);
		expect(b.html).toContain("nested");
		expect(b.html).toContain("show-connector");
	});
	it("collapses consecutive thumbnails into one thumb-row strip", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="feature-artifacts" data-ids="img2"></div><div class="feature-artifacts" data-ids="img3"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(1);
		expect(out[0].html).toContain("thumb-row");
		expect(out[0].html).toContain("img1.png");
		expect(out[0].html).toContain("img3.png");
	});
	it("leaves a lone thumbnail unwrapped", () => {
		const out = finalizeBlocks(splitDocumentBlocks(`<div class="feature-artifacts" data-ids="img1"></div>`), resolver);
		expect(out).toHaveLength(1);
		expect(out[0].html).not.toContain("thumb-row");
	});
	it("breaks a thumbnail run at a non-thumbnail block", () => {
		const html = `<div class="feature-artifacts" data-ids="img1"></div><div class="log-row" data-id="s">step</div><div class="feature-artifacts" data-ids="img2"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(3); // thumb, step, thumb — no grouping across the step
		expect(out.some((b) => b.html.includes("thumb-row"))).toBe(false);
	});
	it("keeps a non-image artifact (json/html/file) out of a thumbnail strip", () => {
		const html = `<div class="standalone-artifact" data-id="doc1"></div><div class="feature-artifacts" data-ids="img1"></div>`;
		const out = finalizeBlocks(splitDocumentBlocks(html), resolver);
		expect(out).toHaveLength(2); // the json frame is not a thumb, so it does not group with the image
	});
});
