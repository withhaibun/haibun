// @vitest-environment jsdom
/**
 * summarizeForKihan projections for the enriched content views: the linked data the chat harvest pulls from the
 * active pane. Seeds each view through its public API and calls the method directly (no render), so this covers the
 * projection shape and the empty→null contract, not layout.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ShuThreadColumn } from "./shu-thread-column.js";
import { ShuAnnotatedBody } from "./shu-annotated-body.js";
import { ShuProductView } from "./shu-product-view.js";

const define = (tag: string, ctor: CustomElementConstructor): void => {
	if (!customElements.get(tag)) customElements.define(tag, ctor);
};

beforeAll(() => {
	define("shu-thread-column", ShuThreadColumn);
	define("shu-annotated-body", ShuAnnotatedBody);
	define("shu-product-view", ShuProductView);
});

describe("summarizeForKihan — enriched view projections", () => {
	it("thread-column: an ordered collection of items with internal keys stripped and the reply surfaced", () => {
		const el = document.createElement("shu-thread-column") as ShuThreadColumn;
		expect(el.summarizeForKihan()).toBeNull(); // empty thread
		el.openItems([
			{ "@id": "c1", "@type": "Comment", body: "root" },
			{ "@id": "c2", "@type": "Comment", body: "reply", _edges: [{ type: "inReplyTo", targetId: "c1" }] },
		]);
		const s = el.summarizeForKihan() as { "@type": string; totalItems: number; items: Array<Record<string, unknown>> };
		expect(s["@type"]).toBe("as:OrderedCollection");
		expect(s.totalItems).toBe(2);
		expect(s.items[1]).toMatchObject({ "@id": "c2", body: "reply", inReplyTo: "c1" });
		expect("_edges" in s.items[1]).toBe(false);
	});

	it("annotated-body: an as:Document carrying its content and each annotation's quote, note, and links", () => {
		const el = document.createElement("shu-annotated-body") as ShuAnnotatedBody;
		expect(el.summarizeForKihan()).toBeNull(); // no content
		el.content = "the body text";
		el.mediaType = "text/markdown";
		el.sourceId = "file:1";
		el.sourceLabel = "Notes";
		el.annotations = [{ commentId: "a1", specificResourceId: "sr1", exact: "body", body: "a note", author: "vid", links: [{ exact: "elsewhere" }] }];
		const s = el.summarizeForKihan() as { "@id": string; "@type": string; content: string; annotations: Array<Record<string, unknown>> };
		expect(s["@id"]).toBe("file:1");
		expect(s["@type"]).toBe("as:Document");
		expect(s.content).toBe("the body text");
		expect(s.annotations[0]).toEqual({ exact: "body", note: "a note", author: "vid", linksTo: ["elsewhere"] });
	});

	it("product-view: delegates to the mounted child, so the wrapper never blanks its subtree", () => {
		const el = document.createElement("shu-product-view") as ShuProductView;
		expect(el.summarizeForKihan()).toBeNull(); // no child mounted
		const child = document.createElement("div") as HTMLElement & { summarizeForKihan?: () => unknown };
		child.summarizeForKihan = () => ({ "@id": "view:result-table", "@type": "as:Collection" });
		el.appendChild(child);
		expect(el.summarizeForKihan()).toEqual({ "@id": "view:result-table", "@type": "as:Collection" });
	});
});
