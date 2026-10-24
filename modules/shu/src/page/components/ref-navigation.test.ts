// @vitest-environment jsdom
/**
 * A reference is a link in the plain HTML sense, an anchor with a real href, so the browser gives it focus, a new
 * tab, a copyable address, and a status-bar preview. The href addresses the ONE thing referred to, not the reader's
 * trail of columns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { deepLinkOf, desiredPaneFor, followPaneLink, paneHref, refHref } from "./ref-navigation.js";
import { refOf } from "../derivations/markdown.js";
import { hashWithColumns } from "../derivations/address.js";
import { declareSpec } from "../../test/catalog-fixture.js";
import { readActualityFeature } from "../client-cache/controllers/device-controller.js";
import { SHU_TAG } from "../../domains/elements.js";
import { addsToSelection, type DesiredPane } from "../derivations/pane-kinds.js";
import { followPaneRequests } from "../../test/pane-requests.js";

describe("refHref", () => {
	it("addresses one column view, not the reader's trail of columns", () => {
		const href = refHref({ kind: REF_DENOTES.type, target: { domain: "Principal" } });
		expect(href).toBe("#?col=type%3APrincipal");
		expect(href?.match(/col=/g)).toHaveLength(1);
	});

	it("addresses an individual, and a step as its record in the actuality feature the page reads (CA4D9)", () => {
		expect(refHref({ kind: REF_DENOTES.individual, target: { persistedAs: "Person", id: "ada@test.com" } })).toContain("col=");
		declareSpec({ types: ["SeqPath"], ui: { SeqPath: { component: SHU_TAG.STEP_DETAIL } } });
		readActualityFeature(undefined);
		expect(desiredPaneFor({ kind: "seqPath", target: { seqPath: [0, 1, 2] } }), "a step's path doesn't name a record before the page reads an actuality feature").toBeNull();
		readActualityFeature("1790000000000-1");
		expect(desiredPaneFor({ kind: "seqPath", target: { seqPath: [0, 1, 2] } })).toEqual({ paneType: "entity", persistedAs: "SeqPath", id: "1790000000000-1.0.1.2" });
		readActualityFeature(undefined);
	});

	it("addresses exactly the pane a click opens: one reading of (kind, target) serves both, so they cannot drift", () => {
		expect(desiredPaneFor({ kind: REF_DENOTES.type, target: { domain: "Principal" } })).toEqual({ paneType: "type", persistedAs: "Principal" });
		expect(desiredPaneFor({ kind: REF_DENOTES.individual, target: { persistedAs: "Person", id: "ada@test.com" } })).toEqual({
			paneType: "entity",
			persistedAs: "Person",
			id: "ada@test.com",
		});
		expect(desiredPaneFor({ kind: "step", target: { method: StepMethodSchema.parse("S-s") } })).toEqual({ paneType: "step", method: "S-s" });
	});

	it("reads a reference that arrives as data only where its target is what its kind names, rather than a link that doesn't open a pane", () => {
		expect(refOf("step", { stepperName: "S", stepName: "s" }), "a step is named by its method").toBeUndefined();
		expect(refOf("step", { method: "not a method" }), "in a method's grammar").toBeUndefined();
		expect(refOf(REF_DENOTES.type, {})).toBeUndefined();
		expect(refOf("nothing", { domain: "Principal" }), "a kind that isn't a reference's").toBeUndefined();
		expect(refOf(REF_DENOTES.type, { domain: "Principal" })).toEqual({ kind: REF_DENOTES.type, target: { domain: "Principal" } });
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
		{ paneType: "entity", persistedAs: "SeqPath", id: "1790000000000-1.0.1.2" },
		{ paneType: "step", method: StepMethodSchema.parse("GraphStepper-graphQuery") },
		{ paneType: "action", action: ActionSchema.parse("Read:private") },
	];

	it("reads back as the pane it addresses, an individual's passage included", () => {
		for (const pane of PANES) expect(deepLinkOf(paneHref(pane))).toEqual({ pane, state: {} });
	});

	it("carries the view state a link opens its pane with", () => {
		expect(deepLinkOf(hashWithColumns(["shu-affordances-panel"], { "aff-goal": "vc" }))).toEqual({
			pane: { paneType: "component", tag: "shu-affordances-panel", label: "shu-affordances-panel" },
			state: { "aff-goal": "vc" },
		});
	});

	it("is only an address of one column; any other href is the browser's to follow", () => {
		expect(deepLinkOf(hashWithColumns(["type:A", "type:B"]))).toBeNull();
		expect(deepLinkOf(`${paneHref(itemAt(PANES, 1))}&active=type%3APrincipal`)).toBeNull();
		expect(deepLinkOf("https://example.com/#?col=type%3AA")).toBeNull();
		expect(deepLinkOf("#section-2")).toBeNull();
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
			return { anchor, heard, opened: followPaneRequests() };
		};

		it("opens the pane it addresses beside the one it was clicked in, and a listener under the page doesn't take the click", () => {
			const { anchor, heard, opened } = linkIn(refHref({ kind: REF_DENOTES.individual, target: { persistedAs: "Email", id: "m-1" } }) ?? "");
			const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
			anchor.dispatchEvent(click);
			expect(opened.requested).toEqual([{ paneType: "entity", persistedAs: "Email", id: "m-1" }]);
			expect(addsToSelection(click), "a plain click replaces the panes after the one it was made in").toBe(false);
			expect(click.defaultPrevented, "the page's address is not replaced").toBe(true);
			expect(heard).not.toHaveBeenCalled();
			opened.stop();
		});

		it("adds the pane beside the others when a modifier is held", () => {
			const { anchor, opened } = linkIn(paneHref(itemAt(PANES, 1)));
			const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true });
			anchor.dispatchEvent(click);
			expect(opened.requested).toEqual([itemAt(PANES, 1)]);
			expect(addsToSelection(click)).toBe(true);
			opened.stop();
		});

		it("leaves a link to anything else to the browser", () => {
			const { anchor, heard, opened } = linkIn("https://example.com/");
			const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
			anchor.dispatchEvent(click);
			expect(opened.requested).toEqual([]);
			opened.stop();
			expect(click.defaultPrevented).toBe(false);
			expect(heard).toHaveBeenCalled();
		});
	});
});
