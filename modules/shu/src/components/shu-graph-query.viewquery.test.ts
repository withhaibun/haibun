// @vitest-environment jsdom
/**
 * shu-graph-query owns the query via the hash-backed viewQuery store. This reproduces, in jsdom, the
 * exact flow the graph-frontend e2e drives — the actions bar's FILTER_CHANGE → setFilters — and asserts
 * the search lands in BOTH the store and the URL hash. It exists because that path can only fail in the
 * browser (a fail-fast schema throw inside viewQuery.set), where the e2e can't see the console; here the
 * throw is a visible test failure.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { viewQuery } from "../view-query.js";
import { ShuGraphQuery } from "./shu-graph-query.js";

if (!customElements.get("shu-graph-query-test")) customElements.define("shu-graph-query-test", ShuGraphQuery);
const make = () => document.createElement("shu-graph-query-test") as ShuGraphQuery;

describe("shu-graph-query → viewQuery", () => {
	beforeEach(() => {
		window.location.hash = "";
		viewQuery.hydrate("");
	});

	it("setFilters from a type selection then a text search writes q to the store and the URL hash", () => {
		const el = make();
		// chooseGraphLabel("Email") — the FILTER_CHANGE the actions bar emits on a type pick.
		el.setFilters({ accessLevel: "private", label: "Email", textQuery: undefined, conditions: [] });
		expect(viewQuery.current.label).toBe("Email");
		// type "INBOX" into the search box — the FILTER_CHANGE on the debounced input.
		el.setFilters({ accessLevel: "private", label: "Email", textQuery: "INBOX", conditions: [] });
		expect(viewQuery.current.q).toBe("INBOX");
		expect(window.location.hash).toContain("q=INBOX");
		expect(window.location.hash).toContain("label=Email");
	});

	it("a select-filter condition (eq) round-trips through setFilters into the store + hash", () => {
		const el = make();
		el.setFilters({ accessLevel: "private", label: "Email", textQuery: undefined, conditions: [{ predicate: "folder", operator: "eq", value: "INBOX" }] });
		expect(viewQuery.current.f).toEqual([{ predicate: "folder", operator: "eq", value: "INBOX" }]);
		expect(decodeURIComponent(window.location.hash)).toContain("f=folder|eq|INBOX");
	});

	it("switching type clears the carried-over sort", () => {
		const el = make();
		el.setFilters({ accessLevel: "private", label: "Email", textQuery: undefined, conditions: [] });
		viewQuery.set({ sort: "dateSent" });
		el.setFilters({ accessLevel: "private", label: "Person", textQuery: undefined, conditions: [] });
		expect(viewQuery.current.label).toBe("Person");
		expect(viewQuery.current.sort).toBeNull();
	});

	it("set products applies a view-query control product, stripping the dispatch hypermedia markers", () => {
		const el = make();
		// the shape a `search for {q}` control step emits after dispatch augments it with hypermedia markers.
		el.products = { q: "INBOX", _component: "shu-graph-query", _type: "view-query", _summary: "view-query", id: "view-query", view: "view-query" };
		expect(viewQuery.current.q).toBe("INBOX");
		el.products = { label: "Person" };
		expect(viewQuery.current.label).toBe("Person");
	});
});
