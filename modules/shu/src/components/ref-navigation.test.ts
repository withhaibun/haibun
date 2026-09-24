// @vitest-environment jsdom
/**
 * A reference is a link in the plain HTML sense, an anchor with a real href, so the browser gives it focus, a new
 * tab, a copyable address, and a status-bar preview. The href addresses the ONE thing referred to, not the reader's
 * trail of columns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { desiredPaneFor, followPaneLink, paneAddressedBy, paneHref, refHref } from "./ref-navigation.js";
import { PaneState, type DesiredPane } from "../pane-state.js";
import { hashWithColumns } from "../view-hash.js";

describe("refHref", () => {
	it("addresses one column view, not the reader's trail of columns", () => {
		const href = refHref("domain", { domain: "Principal" });
		expect(href).toBe("#?col=type%3APrincipal");
		expect(href?.match(/col=/g)).toHaveLength(1);
	});

	it("addresses an individual and a step's quads", () => {
		expect(refHref("entity", { persistedAs: "Person", id: "ada@test.com" })).toContain("col=");
		expect(refHref("seqPath", { seqPath: [0, 1, 2] })).toContain("col=");
	});

	it("addresses exactly the pane a click opens: one reading of (kind, target) serves both, so they cannot drift", () => {
		expect(desiredPaneFor("domain", { domain: "Principal" })).toEqual({ paneType: "type", persistedAs: "Principal" });
		expect(desiredPaneFor("entity", { persistedAs: "Person", id: "ada@test.com" })).toEqual({ paneType: "entity", persistedAs: "Person", id: "ada@test.com" });
		expect(desiredPaneFor("step", { stepperName: "S", stepName: "s" })).toBeNull();
	});

	it("is no link at all for a kind with no pane, rather than one that goes nowhere", () => {
		expect(refHref("step", { stepperName: "S", stepName: "s" })).toBeUndefined();
		expect(refHref("domain", {})).toBeUndefined();
	});
});

describe("a link to a pane", () => {
	const PASSAGE: DesiredPane = { paneType: "entity", persistedAs: "Document", id: "spec-1", selector: { exact: "holder binding, checked", prefix: "the-", suffix: "-then" } };
	const PANES: DesiredPane[] = [
		PASSAGE,
		{ paneType: "type", persistedAs: "Principal" },
		{ paneType: "filter-eq", persistedAs: "Email", predicate: "from", value: "a@test.com" },
		{ paneType: "filter-incoming", persistedAs: "Email", subject: "m-1" },
		{ paneType: "thread", persistedAs: "Email", subject: "m-1" },
		{ paneType: "step-detail", seqPath: [0, 1, 2] },
	];

	it("reads back as the pane it addresses, an individual's passage included", () => {
		for (const pane of PANES) expect(paneAddressedBy(paneHref(pane))).toEqual(pane);
	});

	it("is only an address of one column; any other href is the browser's to follow", () => {
		expect(paneAddressedBy(hashWithColumns(["type:A", "type:B"]))).toBeNull();
		expect(paneAddressedBy(`${paneHref(PANES[1])}&active=type%3APrincipal`)).toBeNull();
		expect(paneAddressedBy("https://example.com/#?col=type%3AA")).toBeNull();
		expect(paneAddressedBy("#section-2")).toBeNull();
	});

	describe("clicked", () => {
		afterEach(() => {
			document.removeEventListener("click", followPaneLink, { capture: true });
			vi.restoreAllMocks();
			document.body.innerHTML = "";
		});

		/** A link inside a view's shadow root, as a column renders one, with the page following links. */
		const linkIn = (href: string) => {
			document.addEventListener("click", followPaneLink, { capture: true });
			const view = document.body.appendChild(document.createElement("div"));
			const anchor = view.attachShadow({ mode: "open" }).appendChild(document.createElement("a"));
			anchor.href = href;
			const heard = vi.fn();
			view.addEventListener("click", heard);
			anchor.addEventListener("click", heard);
			return { anchor, heard, opened: vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined) };
		};

		it("opens the pane it addresses beside the one it was clicked in, and nothing under the page takes the click", () => {
			const { anchor, heard, opened } = linkIn(refHref(REF_DENOTES.individual, { persistedAs: "Email", id: "m-1" }) ?? "");
			const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
			anchor.dispatchEvent(click);
			expect(opened).toHaveBeenCalledWith(click, { paneType: "entity", persistedAs: "Email", id: "m-1" }, false);
			expect(click.defaultPrevented, "the page's address is not replaced").toBe(true);
			expect(heard).not.toHaveBeenCalled();
		});

		it("adds the pane beside the others when a modifier is held", () => {
			const { anchor, opened } = linkIn(paneHref(PANES[1]));
			anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true }));
			expect(opened.mock.calls[0][2]).toBe(true);
		});

		it("leaves a link to anything else to the browser", () => {
			const { anchor, heard, opened } = linkIn("https://example.com/");
			const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
			anchor.dispatchEvent(click);
			expect(opened).not.toHaveBeenCalled();
			expect(click.defaultPrevented).toBe(false);
			expect(heard).toHaveBeenCalled();
		});
	});
});
