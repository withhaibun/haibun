// @vitest-environment jsdom
/**
 * Runtime contract for the affordance-pane opener.
 *
 * If a `show <view>` step's parsed action reaches `openPinnedColumn`, a pane
 * with the matching column-type appears in the strip and a child element with
 * the named tag is appended. Holds for both built-in singleton views (graph,
 * monitor, sequence, document) and external per-instance views (fisheye).
 *
 * Pins the runtime so a future regression that breaks "show graph view" but
 * leaves the parser intact still fails a test instead of silently breaking
 * the SPA.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { openPinnedColumn } from "./pane-opener.js";
import { SHU_ATTR } from "./consts.js";

describe("openPinnedColumn", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		class FakePane extends HTMLElement {}
		class FakeStrip extends HTMLElement {
			get panes(): Element[] {
				return Array.from(this.children);
			}
			addPane(pane: HTMLElement): void {
				this.appendChild(pane);
			}
		}
		if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", FakePane);
		if (!customElements.get("shu-column-strip")) customElements.define("shu-column-strip", FakeStrip);
	});

	function makeStrip(): HTMLElement & { panes: Element[]; addPane(p: HTMLElement): void } {
		const strip = document.createElement("shu-column-strip") as HTMLElement & { panes: Element[]; addPane(p: HTMLElement): void };
		document.body.appendChild(strip);
		return strip;
	}

	const cases: Array<{ name: string; columnType: string; label: string; childTag: string }> = [
		{ name: "graph view (singleton)", columnType: "graph", label: "Graph view", childTag: "shu-graph-view" },
		{ name: "monitor (singleton)", columnType: "monitor", label: "Monitor log stream", childTag: "shu-monitor-column" },
		{ name: "sequence (singleton)", columnType: "sequence", label: "Sequence diagram", childTag: "shu-sequence-diagram" },
		{ name: "document (singleton)", columnType: "document", label: "Document view", childTag: "shu-document-column" },
		{ name: "fisheye per-instance id", columnType: "shu-fisheye-graph-view:abc-123", label: "Fisheye 3D graph view", childTag: "shu-fisheye-graph-view" },
	];

	for (const { name, columnType, label, childTag } of cases) {
		it(`opens a pane for ${name}: column-type="${columnType}" with <${childTag}> child`, async () => {
			// Custom element for the child must already be registered for openPinnedColumn
			// to do an appendChild — match the production assumption that the registry
			// either has the class (built-ins via registerComponents) or ensureUiComponentLoaded
			// has just imported it (external components like fisheye).
			class FakeChild extends HTMLElement {}
			if (!customElements.get(childTag)) customElements.define(childTag, FakeChild);

			const strip = makeStrip();
			let ensureCalled = "";
			await openPinnedColumn(columnType, label, childTag, {
				// biome-ignore lint/suspicious/noExplicitAny: test-only — the real ShuColumnStrip class is heavier than this contract requires.
getStrip: () => strip as any,
				ensureUiComponentLoaded: (tag) => {
					ensureCalled = tag;
					return Promise.resolve();
				},
			});

			expect(ensureCalled).toBe(childTag);
			expect(strip.panes).toHaveLength(1);
			const pane = strip.panes[0];
			expect(pane.getAttribute(SHU_ATTR.COLUMN_TYPE)).toBe(columnType);
			expect(pane.getAttribute("label")).toBe(label);
			expect(pane.hasAttribute(SHU_ATTR.PINNED)).toBe(true);
			expect(pane.children).toHaveLength(1);
			expect(pane.children[0].tagName.toLowerCase()).toBe(childTag);
			expect(pane.children[0].hasAttribute(SHU_ATTR.SHOW_CONTROLS)).toBe(true);
		});
	}

	it("is idempotent: a second call with the same column-type does not create a duplicate pane", async () => {
		class FakeChild extends HTMLElement {}
		const tag = `shu-test-${Math.random().toString(36).slice(2, 8)}`;
		customElements.define(tag, FakeChild);
		const strip = makeStrip();
		const opts = {
			// biome-ignore lint/suspicious/noExplicitAny: test-only — the real ShuColumnStrip class is heavier than this contract requires.
getStrip: () => strip as any,
			ensureUiComponentLoaded: () => Promise.resolve(),
		};
		await openPinnedColumn("idem", "Idempotent", tag, opts);
		await openPinnedColumn("idem", "Idempotent", tag, opts);
		expect(strip.panes).toHaveLength(1);
	});

	it("throws when the strip is missing — caller cannot silently lose a view", async () => {
		await expect(
			openPinnedColumn("graph", "Graph view", "shu-graph-view", {
				getStrip: () => null,
				ensureUiComponentLoaded: () => Promise.resolve(),
			}),
		).rejects.toThrow(/no column-strip/);
	});
});
