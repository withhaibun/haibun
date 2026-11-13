// @vitest-environment jsdom
/**
 * shu-graph-query owns the query via the hash-backed viewQuery store. This reproduces, in jsdom, the
 * exact flow the graph-frontend e2e drives, the actions bar's FILTER_CHANGE → setFilters, and asserts
 * the search lands in BOTH the store and the URL hash. It exists because that path can only fail in the
 * browser (a fail-fast schema throw inside viewQuery.set), where the e2e can't see the console; here the
 * throw is a visible test failure.
 */
import { newPage } from "../../test/setup.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TGraphQueryResult } from "@haibun/core/lib/quad-types.js";
import { QueryController } from "../controllers/query-controller.js";
import { viewQuery } from "../controllers/view-query-controller.js";
import { ViewQuerySchema } from "../domains/view-query.js";
import { ShuGraphQuery } from "./shu-graph-query.js";

const make = () => new ShuGraphQuery();

describe("shu-graph-query → viewQuery", () => {
	beforeEach(() => {
		newPage();
		window.location.hash = "";
		viewQuery.hydrate("");
	});

	it("setFilters from a type selection then a text search writes q to the store and the URL hash", () => {
		const el = make();
		// chooseGraphLabel("Email"): the FILTER_CHANGE the actions bar emits on a type pick.
		el.setFilters({ readLevel: "private", label: "Email", textQuery: undefined });
		expect(viewQuery.current.label).toBe("Email");
		// type "INBOX" into the search box: the FILTER_CHANGE on the debounced input.
		el.setFilters({ readLevel: "private", label: "Email", textQuery: "INBOX" });
		expect(viewQuery.current.q).toBe("INBOX");
		expect(window.location.hash).toContain("q=INBOX");
		expect(window.location.hash).toContain("label=Email");
	});

	it("a search's class expression round-trips through setFilters into the store + hash", () => {
		const el = make();
		el.setFilters({ readLevel: "private", label: "Email", textQuery: undefined, expression: 'folder value "INBOX"' });
		expect(viewQuery.current.x).toBe('folder value "INBOX"');
		expect(new URLSearchParams(window.location.hash.slice(2)).get("x")).toBe('folder value "INBOX"');
	});

	it("switching type clears the carried-over sort", () => {
		const el = make();
		el.setFilters({ readLevel: "private", label: "Email", textQuery: undefined });
		viewQuery.set({ sort: "dateSent" });
		el.setFilters({ readLevel: "private", label: "Person", textQuery: undefined });
		expect(viewQuery.current.label).toBe("Person");
		expect(viewQuery.current.sort).toBeNull();
	});

	it("drops the rows of the previous search while the next search is in flight", async () => {
		const page = (id: string) => ({ vertices: [{ "@type": "File", id }], total: 1, saturated: false }) as unknown as TGraphQueryResult;
		const next = Promise.withResolvers<TGraphQueryResult>();
		vi.spyOn(QueryController.prototype, "run").mockResolvedValueOnce(page("door-note")).mockReturnValueOnce(next.promise);
		const el = make();
		const rows = () => (el as unknown as { results: Array<{ id: string }> }).results.map(({ id }) => id);
		viewQuery.set({ q: "door" });
		await el.executeQuery();
		expect(rows()).toEqual(["door-note"]);
		viewQuery.set({ q: "invoice" });
		const searched = el.executeQuery();
		await vi.waitFor(() => expect(rows(), "a row of the search for door isn't listed while the search for invoice is in flight").toEqual([]));
		next.resolve(page("invoice"));
		await searched;
		expect(rows()).toEqual(["invoice"]);
	});

	it("restoring a recorded search sets the store to its query", () => {
		const el = make();
		el.restoreSearch(ViewQuerySchema.parse({ q: "INBOX", label: "Email" }));
		expect([viewQuery.current.q, viewQuery.current.label]).toEqual(["INBOX", "Email"]);
	});
});
