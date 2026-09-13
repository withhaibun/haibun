// @vitest-environment jsdom
/**
 * The actions bar's search mode, held apart from the bar: the conditions a search runs, the search a type read from the
 * address describes, a picked type announced once with its filters cleared, typed text committed once typing rests, a
 * search recorded once while it is the newest entry, and the distinct values a batch of events adds for the type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";

vi.mock("../rpc-registry.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getAvailableSteps: () => Promise.resolve([]),
	getAvailableDomains: () => Promise.resolve({}),
	buildDomainOptions: () => [
		{ key: "email-domain", queryLabel: "Email", group: "declared" },
		{ key: "file-domain", queryLabel: "File", group: "declared" },
	],
}));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getQueryableFields: () => ["folder", "subject"] }));
vi.mock("../quads-snapshot.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), selectValuesFor: () => Promise.resolve({ folder: ["INBOX"] }) }));

const { ActionsBarQuery, SEARCH_DEBOUNCE_MS, searchConditions } = await import("./actions-bar-query.js");
const { aControllerHost } = await import("./actions-bar-host.test-fake.js");
const { SHU_EVENT, SHU_TAG } = await import("../consts.js");
const { getSelectValues } = await import("../rels-cache.js");
const { viewQuery } = await import("../view-query.js");

type TFilterChange = { asked: boolean; label: string; accessLevel: string; conditions: TSearchCondition[] };

async function aQueryPage(hash = "") {
	history.replaceState(null, "", hash || location.pathname);
	const host = aControllerHost();
	const searches = document.createElement("div");
	host.append(searches);
	const changes: TFilterChange[] = [];
	host.addEventListener(SHU_EVENT.FILTER_CHANGE, (e) => changes.push((e as CustomEvent<TFilterChange>).detail));
	const query = new ActionsBarQuery(host, {
		testIdPrefix: () => "app-",
		history: () => searches as never,
		find: (selector) => host.querySelector(selector),
		findAll: (selector) => Array.from(host.querySelectorAll(selector)),
		setStatus: () => undefined,
		fail: (message) => {
			throw new Error(message);
		},
		onTrailChange: () => undefined,
	});
	await query.loadDomains();
	await settled();
	render(query.template(html``), host);
	return { host, query, searches, changes };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const recorded = (searches: HTMLElement) => searches.querySelectorAll(SHU_TAG.SEARCH_SUMMARY).length;

describe("the actions bar's search mode", () => {
	beforeEach(() => {
		viewQuery.set({ q: null });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs each select filter with a value and each filter row that names a field, and no row still unnamed", () => {
		const rows: TSearchCondition[] = [
			{ predicate: "subject", operator: "contains", value: "crumb" },
			{ predicate: "", operator: "eq", value: "left unnamed" },
		];
		expect(searchConditions({ folder: "INBOX", account: "" }, rows)).toEqual([{ predicate: "folder", operator: "eq", value: "INBOX" }, rows[0]]);
	});

	it("reads the type and field filters the address names, and announces that search as not asked for", async () => {
		const { query, changes } = await aQueryPage("#?label=File&f=folder|eq|Drafts");
		expect(query.selectedLabel).toBe("File");
		expect(changes).toEqual([{ asked: false, accessLevel: query.accessLevel, label: "File", conditions: [{ predicate: "folder", operator: "eq", value: "Drafts" }] }]);
	});

	it("reads the first type where the address names none, and fails on a label no type carries", async () => {
		const { query } = await aQueryPage();
		expect(query.selectedLabel).toBe("Email");
		expect(() => query.setContext([], query.accessLevel, { label: "Nothing" })).toThrow("Selected label is not present in discovered concerns: Nothing");
	});

	it("announces a picked type once, as asked for, with its select filters cleared", async () => {
		const { host, query, changes } = await aQueryPage("#?f=folder|eq|Drafts");
		changes.length = 0;
		host.querySelector(".label-select")?.dispatchEvent(new CustomEvent("combo-change", { detail: { value: "file-domain" } }));
		expect(query.selectedLabel).toBe("File");
		expect(changes).toEqual([{ asked: true, accessLevel: query.accessLevel, label: "File", conditions: [] }]);
	});

	it("commits typed text once typing rests, and records the search once while it is the newest entry", async () => {
		const { host, changes, searches } = await aQueryPage();
		changes.length = 0;
		vi.useFakeTimers();
		const input = host.querySelector<HTMLInputElement>(".text-search") as HTMLInputElement;
		for (const typed of ["c", "cr", "crumb"]) {
			input.value = typed;
			input.dispatchEvent(new Event("input"));
		}
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
		expect(viewQuery.current.q).toBe("crumb");
		expect(changes).toHaveLength(1);
		vi.useRealTimers();
		input.dispatchEvent(new Event("blur"));
		input.dispatchEvent(new Event("blur"));
		expect(recorded(searches), "leaving the box twice records the same search once").toBe(1);
		input.value = "dough";
		input.dispatchEvent(new Event("blur"));
		expect(recorded(searches)).toBe(2);
	});

	it("adds the distinct values a batch of events brings for the selected type, and none for another type", async () => {
		const { host, query } = await aQueryPage();
		const before = host.updatesAsked;
		const quad = (namedGraph: string, object: string) => ({
			kind: "artifact",
			artifactType: "json",
			json: { quadObservation: { subject: "m1", predicate: "folder", object, namedGraph } },
		});
		query.observe([quad("File", "Archive")] as never);
		expect(host.updatesAsked, "a value for another type").toBe(before);
		query.observe([quad("Email", "Drafts")] as never);
		expect(getSelectValues("Email").folder).toEqual(["Drafts", "INBOX"]);
		expect(host.updatesAsked).toBe(before + 1);
	});
});
