/** The browser's member domains read their types' records in pages, so a store that refuses a read of a whole type as quads
 *  serves them, and each states the fields its quantifier reads. */
import { describe, expect, it } from "vitest";
import { Access, HTTP_HOST_LABEL, HTTP_REQUEST_LABEL } from "@haibun/core/lib/domains/resources.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { VISITED_PAGE_LABEL, WebPlaywrightDomains } from "../domains/web-playwright.js";
import { TRACE_MEMBER_DOMAINS } from "./trace-members.js";

/** The time of a record of the trace, at a minute of one hour. */
const minute = (at: number): number => Date.UTC(2026, 9, 22, 12, at);
const at = (on: number) => new Date(minute(on)).toISOString();

/** A world whose store holds a request, a host and two visits, and refuses a quad read, as a store keyed by its records does. */
async function worldHoldingTrace(): Promise<TWorld> {
	const store = storeOfDomains(WebPlaywrightDomains);
	await store.merge({
		"@type": HTTP_REQUEST_LABEL,
		id: "GET /app",
		method: "GET",
		status: 200,
		durationMs: 12,
		url: "http://localhost/app",
		accessLevel: Access.private,
		generatedAtTime: at(0),
	});
	await store.merge({ "@type": HTTP_HOST_LABEL, id: "localhost", name: "localhost", requestCount: 3, accessLevel: Access.private, generatedAtTime: at(0) });
	await store.merge({ "@type": VISITED_PAGE_LABEL, id: "visit-b", name: "http://localhost/second", accessLevel: Access.private, generatedAtTime: at(2) });
	await store.merge({ "@type": VISITED_PAGE_LABEL, id: "visit-a", name: "http://localhost/first", accessLevel: Access.private, generatedAtTime: at(1) });
	store.query = () => Promise.reject(new Error("the store reads quads by a key"));
	return { shared: { getStore: () => store } } as unknown as TWorld;
}

const members = async (name: string, endedBy: number) => {
	const domain = TRACE_MEMBER_DOMAINS.find(({ selectors }) => selectors.includes(name));
	if (domain?.members === undefined) throw new Error(`the browser doesn't offer the member domain ${name}`);
	return domain.members.read(await worldHoldingTrace(), endedBy, {});
};
const ids = async (name: string, endedBy: number) => (await members(name, endedBy)).map(({ id }) => id).sort();

describe("the browser's member domains", () => {
	it("state each request's fields, each host's count of requests and each visit by its URL, through paged reads", async () => {
		expect(await members("http-trace", minute(59))).toEqual([expect.objectContaining({ id: "GET /app", status: 200, url: "http://localhost/app" })]);
		expect(await members("http-trace hosts", minute(59))).toEqual([expect.objectContaining({ id: "localhost", requestCount: 3 })]);
		expect(await ids("visited pages", minute(59))).toEqual(["http://localhost/first", "http://localhost/second"]);
	});

	it("state only the records written at or before the quantifier's start", async () => {
		expect(await ids("visited pages", minute(1))).toEqual(["http://localhost/first"]);
		expect(await members("http-trace hosts", minute(0) - 1)).toEqual([]);
	});
});
