// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { groupThumbnailRows } from "./thumbnail-rows.js";

const thumb = '<div class="standalone-artifact"><shu-artifact-frame class="thumb"><img alt="" /></shu-artifact-frame></div>';
const fullArtifact = '<div class="standalone-artifact"><shu-artifact-frame><pre>json</pre></shu-artifact-frame></div>';
const step = '<div class="log-row">a step</div>';

function body(...html: string[]): HTMLElement {
	const b = document.createElement("div");
	b.innerHTML = html.join("");
	return b;
}
const rowsOf = (b: HTMLElement) => Array.from(b.children).filter((c) => c.classList.contains("thumb-row"));
const thumbCount = (el: Element) => el.querySelectorAll("shu-artifact-frame.thumb").length;

describe("groupThumbnailRows", () => {
	it("wraps each run of consecutive thumbnails into a .thumb-row, leaving other elements ungrouped", () => {
		const b = body(step, thumb, thumb, step, thumb, thumb, thumb);
		groupThumbnailRows(b);
		const rows = rowsOf(b);
		expect(rows.length).toBe(2);
		expect(thumbCount(rows[0])).toBe(2);
		expect(thumbCount(rows[1])).toBe(3);
		expect(Array.from(b.children).filter((c) => c.classList.contains("log-row")).length).toBe(2);
	});

	it("drops empty artifact placeholders (e.g. dispatch traces) so the screenshots they sit between still group", () => {
		const emptyTrace = '<div class="standalone-artifact" data-id="dispatch.0.1"></div>'; // a non-renderable artifact: empty div
		const b = body(step, thumb, emptyTrace, thumb, emptyTrace, thumb);
		groupThumbnailRows(b);
		const rows = rowsOf(b);
		expect(rows.length).toBe(1);
		expect(thumbCount(rows[0])).toBe(3);
		expect(b.querySelectorAll(".standalone-artifact:empty").length).toBe(0); // ghosts removed, not left to break the run
	});

	it("a non-thumbnail (full-size) artifact ends the run", () => {
		const b = body(thumb, thumb, fullArtifact, thumb);
		groupThumbnailRows(b);
		const rows = rowsOf(b);
		expect(rows.length).toBe(2);
		expect(thumbCount(rows[0])).toBe(2);
		expect(thumbCount(rows[1])).toBe(1);
	});

	it("is idempotent across an incremental append (unwrap then re-group)", () => {
		const b = body(thumb, thumb);
		groupThumbnailRows(b);
		b.insertAdjacentHTML("beforeend", thumb); // a later SSE append adds another screenshot
		groupThumbnailRows(b);
		const rows = rowsOf(b);
		expect(rows.length).toBe(1);
		expect(thumbCount(rows[0])).toBe(3);
	});

	it("preserves document order", () => {
		const b = body(step, thumb);
		groupThumbnailRows(b);
		const kids = Array.from(b.children);
		expect(kids[0].className).toBe("log-row");
		expect(kids[1].className).toBe("thumb-row");
	});

	it("does nothing when there are no thumbnails", () => {
		const b = body(step, step);
		groupThumbnailRows(b);
		expect(rowsOf(b).length).toBe(0);
		expect(b.children.length).toBe(2);
	});
});
