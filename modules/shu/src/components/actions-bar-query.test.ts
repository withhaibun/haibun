// @vitest-environment jsdom
/**
 * The actions bar's search mode, held apart from the bar: the conditions a search runs, the search a type read from the
 * address describes, a picked type announced once with its filters cleared, typed text committed once typing rests, a
 * search recorded once while it is the newest entry, and the distinct values a batch of events adds for the type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { pageTypes } from "../signals.js";
import { ActionsBarQuery, SEARCH_DEBOUNCE_MS, searchConditions } from "./actions-bar-query.js";
import { aControllerHost } from "./controller-host.test-fake.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { getSelectValues } from "../rels-cache.js";
import { setGraphStore } from "../quads-snapshot.js";
import { typeNotHeld, viewQuery } from "../view-query.js";
import { declaringSteps, persistedTypeDefinition, setupShuTest, stepsChanged, stepsReadAgain, stepsShown, type TShuTestHandle } from "../test-setup.js";

/** The fields each type takes as filters: the folder a record is filed in, whose values the search offers, and its subject. */
const FILED = { folder: LinkRelations.CONTEXT.rel, subject: LinkRelations.NAME.rel };
/** The types actuality declares, which a case adds to. */
const declaredTypes = [
	persistedTypeDefinition("Email", { selector: "email-domain", properties: FILED, declared: true }),
	persistedTypeDefinition("File", { selector: "file-domain", properties: FILED, declared: true }),
];
/** The one email the page caches, filed in the one folder the search offers until a batch brings another. */
const CACHED = [{ subject: "m0", predicate: "folder", object: "INBOX", namedGraph: "Email", timestamp: 1 }];
/** A type the address names that actuality doesn't hold. */
const NOT_HELD = "Nothing";

type TFilterChange = { asked: boolean; label: string; accessLevel: string; conditions: TSearchCondition[] };

async function aQueryPage(hash = "") {
	history.replaceState(null, "", hash || location.pathname);
	const host = aControllerHost();
	const searches = document.createElement("div");
	host.append(searches);
	const changes: TFilterChange[] = [];
	const statuses: string[] = [];
	host.addEventListener(SHU_EVENT.FILTER_CHANGE, (e) => changes.push((e as CustomEvent<TFilterChange>).detail));
	const query = new ActionsBarQuery(host, {
		testIdPrefix: () => "app-",
		history: searches as never,
		setStatus: (status: string) => void statuses.push(status),
		onTrailChange: () => undefined,
	});
	host.connect();
	await query.loadDomains();
	await settled();
	render(query.template(html``), host);
	return { host, query, searches, changes, statuses };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const recorded = (searches: HTMLElement) => searches.querySelectorAll(SHU_TAG.SEARCH_SUMMARY).length;

describe("the actions bar's search mode", () => {
	let t: TShuTestHandle;
	beforeEach(async () => {
		t = setupShuTest({ dispatch: declaringSteps(() => stepsShown([], {}, buildConcernCatalog(mapDefinitionsToDomains(declaredTypes)))) });
		const cached = new QuadStore();
		await cached.setMany(CACHED);
		setGraphStore(cached);
		viewQuery.set({ q: null });
	});
	afterEach(() => {
		t.teardown();
		vi.useRealTimers();
	});

	it("runs each select filter with a value and each filter row that names a field, and doesn't run a row still unnamed", () => {
		const rows: TSearchCondition[] = [
			{ predicate: "subject", operator: "contains", value: "crumb" },
			{ predicate: "", operator: "eq", value: "left unnamed" },
		];
		expect(searchConditions({ folder: "INBOX", account: "" }, rows)).toEqual([{ predicate: "folder", operator: "eq", value: "INBOX" }, rows[0]]);
	});

	it("states the types actuality declares once the page has read actuality's steps again, and doesn't announce a search", async () => {
		const { host, changes } = await aQueryPage();
		declaredTypes.push(persistedTypeDefinition("Note", { selector: "note-domain", declared: true }));
		const asked = host.updatesAsked;
		const announced = changes.length;
		const read = stepsReadAgain();
		stepsChanged(t, 1);
		await read;
		expect(host.updatesAsked).toBeGreaterThan(asked);
		expect(changes.length, "the search a reader chose is not announced again").toBe(announced);
		// The page strip offers the types, so the search states them rather than rendering them itself.
		expect(
			pageTypes.get().options.map((o) => o.value),
			"the types the page offers",
		).toContain("note-domain");
		host.disconnect();
		declaredTypes.pop();
	});

	it("reads the type and field filters the address names, and announces that search as not asked for", async () => {
		const { query, changes } = await aQueryPage("#?label=File&f=folder|eq|Drafts");
		expect(query.selectedLabel).toBe("File");
		expect(changes).toEqual([{ asked: false, accessLevel: query.accessLevel, label: "File", conditions: [{ predicate: "folder", operator: "eq", value: "Drafts" }] }]);
	});

	it("reads the first type where the address doesn't name one, and keeps a label that the types don't carry, stating that actuality doesn't hold such a type", async () => {
		const { query, statuses } = await aQueryPage();
		expect(query.selectedLabel).toBe("Email");
		query.setContext([], query.accessLevel, { label: NOT_HELD });
		expect(query.selectedLabel, "the label stays as it was named").toBe(NOT_HELD);
		expect(pageTypes.get().selected, "the types actuality holds aren't chosen for it").toBe("");
		expect(pageTypes.get().options.length, "and actuality's types are all offered").toBeGreaterThan(0);
		expect(statuses).toContain(typeNotHeld(NOT_HELD));
	});

	it("announces a type the strip states once, as asked for, with its select filters cleared, and states it as the type read", async () => {
		const { query, changes } = await aQueryPage("#?f=folder|eq|Drafts");
		changes.length = 0;
		query.chooseType("file-domain");
		expect(query.selectedLabel).toBe("File");
		expect(changes).toEqual([{ asked: true, accessLevel: query.accessLevel, label: "File", conditions: [] }]);
		expect(pageTypes.get().selected, "the strip shows the type the search reads").toBe("file-domain");
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

	it("adds the distinct values a batch of events brings for the selected type, and doesn't add values for another type", async () => {
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
