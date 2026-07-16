/**
 * The viewQuery store is the single hash-backed source of truth for the query params, so a reload must
 * restore the exact view. These pin the two invariants that guarantee it: (1) object round-trip —
 * parse(serialize(q)) deep-equals q for any valid query; (2) canonical string round-trip —
 * serialize(parse(h)) === h for a canonical hash. Plus fail-fast: a malformed param throws, never
 * silently resets (no `|| default`, no `parseInt || 0`).
 */
import { describe, expect, it } from "vitest";
import { ViewQuerySchema, type TViewQuery, parseViewQuery, serializeViewQuery, viewQuery } from "./view-query.js";
import { canonicalizeArrival } from "./view-hash.js";

const DEFAULTS: TViewQuery = ViewQuerySchema.parse({});

describe("viewQuery serialize/parse", () => {
	it("empty hash yields all defaults, which serialize back to empty", () => {
		expect(parseViewQuery("")).toEqual(DEFAULTS);
		expect(serializeViewQuery(DEFAULTS)).toBe("");
	});

	it("object round-trips: parse(serialize(q)) deep-equals q", () => {
		const queries: TViewQuery[] = [
			{ ...DEFAULTS, label: "Email" },
			{ ...DEFAULTS, label: "Email", q: "INBOX" },
			{ ...DEFAULTS, sort: "dateSent", order: "asc" },
			{ ...DEFAULTS, offset: 40 },
			{ ...DEFAULTS, access: "public" },
			{ ...DEFAULTS, label: "Email", f: [{ predicate: "folder", operator: "eq", value: "INBOX" }] },
			{ ...DEFAULTS, f: [{ predicate: "size", operator: "between", value: "1", value2: "9" }] },
			{ label: "Person", q: "ada", sort: "name", order: "asc", offset: 10, access: "opened", f: [{ predicate: "city", operator: "contains", value: "lon" }] },
		];
		for (const q of queries) expect(parseViewQuery(serializeViewQuery(q))).toEqual(q);
	});

	it("canonical string round-trips: serialize(parse(h)) === h (pipe-free params)", () => {
		for (const h of ["#?label=Email", "#?label=Email&q=INBOX", "#?order=asc", "#?offset=20", "#?access=public", "#?label=Email&order=asc&offset=5"]) {
			expect(serializeViewQuery(parseViewQuery(h))).toBe(h);
		}
	});

	it("omits defaults from the canonical hash", () => {
		expect(serializeViewQuery({ ...DEFAULTS, order: "desc", offset: 0, access: "private" })).toBe("");
		expect(serializeViewQuery({ ...DEFAULTS, label: "Email", order: "desc" })).toBe("#?label=Email");
	});

	it("fail-fast: a malformed param throws rather than silently resetting", () => {
		expect(() => parseViewQuery("#?order=sideways")).toThrow();
		expect(() => parseViewQuery("#?offset=abc")).toThrow();
		expect(() => parseViewQuery("#?offset=-3")).toThrow();
		expect(() => parseViewQuery("#?access=root")).toThrow();
		expect(() => parseViewQuery("#?f=folder|bogusop|x")).toThrow();
	});
});

describe("viewQuery store", () => {
	it("hydrate(hash) loads the signals; current reflects it", () => {
		viewQuery.hydrate("#?label=Email&q=INBOX&offset=20&order=asc");
		expect(viewQuery.current).toEqual({ ...DEFAULTS, label: "Email", q: "INBOX", offset: 20, order: "asc" });
		viewQuery.hydrate("");
		expect(viewQuery.current).toEqual(DEFAULTS);
	});

	it("keeps the live query when an open= fragment arrives (a document's view link names no query state)", () => {
		const live = "#?label=File&sort=dateModified&col=shu-monitor-column";
		viewQuery.hydrate(live);
		expect(viewQuery.current.label).toBe("File");
		// The link's fragment carries only the pane request; view-hash canonicalizes it against the live
		// address at its ingress, so what hydrate reads keeps label and sort — assigning from the raw
		// fragment would drop them, and every SSE retrigger would then re-issue a query the server
		// rejects (one 422 per event).
		viewQuery.hydrate(canonicalizeArrival("#?open=shu-fisheye-graph-view", live));
		expect(viewQuery.current.label).toBe("File");
		expect(viewQuery.current.sort).toBe("dateModified");
	});

	it("set() validates, applies, and round-trips through the live hash", () => {
		viewQuery.hydrate("");
		viewQuery.set({ label: "Email", q: "widgets" });
		expect(viewQuery.current.label).toBe("Email");
		expect(viewQuery.current.q).toBe("widgets");
		// What set() wrote must hydrate back to the same query.
		expect(parseViewQuery(serializeViewQuery(viewQuery.current))).toEqual(viewQuery.current);
		expect(() => viewQuery.set({ offset: -1 })).toThrow();
	});
});
