/** The browser's observation sources read their types' records in pages, so a store that refuses a read of a whole type as
 *  quads serves them, and each states the facts its quantifier reads. */
import { describe, expect, it } from "vitest";
import { Access, HTTP_HOST_LABEL, HTTP_REQUEST_LABEL } from "@haibun/core/lib/domains/resources.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { VISITED_PAGE_LABEL, WebPlaywrightDomains } from "../domains/web-playwright.js";
import { HTTP_TRACE_SOURCES } from "./observations.js";

/** A world whose store holds a request, a host and two visits, and refuses a quad read, as a store keyed by its records does. */
async function worldHoldingTrace(): Promise<TWorld> {
	const store = storeOfDomains(WebPlaywrightDomains);
	const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 12, minute)).toISOString();
	await store.upsertIndividual(HTTP_REQUEST_LABEL, {
		id: "GET /app",
		method: "GET",
		status: 200,
		durationMs: 12,
		url: "http://localhost/app",
		accessLevel: Access.private,
		generatedAtTime: at(0),
	});
	await store.upsertIndividual(HTTP_HOST_LABEL, { id: "localhost", name: "localhost", requestCount: 3, accessLevel: Access.private, generatedAtTime: at(0) });
	await store.upsertIndividual(VISITED_PAGE_LABEL, { id: "visit-b", name: "http://localhost/second", accessLevel: Access.private, generatedAtTime: at(2) });
	await store.upsertIndividual(VISITED_PAGE_LABEL, { id: "visit-a", name: "http://localhost/first", accessLevel: Access.private, generatedAtTime: at(1) });
	store.query = () => Promise.reject(new Error("the store reads quads by a key"));
	return { shared: { getStore: () => store } } as unknown as TWorld;
}

const observed = async (name: string) => {
	const source = HTTP_TRACE_SOURCES.find((candidate) => candidate.name === name);
	if (source === undefined) throw new Error(`the browser doesn't offer the observation source ${name}`);
	return source.observe(await worldHoldingTrace());
};

describe("the browser's observation sources", () => {
	it("state each request's fields, each host's count of requests and each visit in its order, through paged reads", async () => {
		expect(await observed("http-trace")).toEqual(
			expect.arrayContaining([
				{ subject: "GET /app", predicate: "status", object: 200 },
				{ subject: "GET /app", predicate: "url", object: "http://localhost/app" },
			]),
		);
		expect(await observed("http-trace hosts")).toEqual([{ subject: "localhost", predicate: "requestCount", object: 3 }]);
		expect(await observed("visited pages")).toEqual([
			{ subject: "http://localhost/first", predicate: "index", object: 0 },
			{ subject: "http://localhost/second", predicate: "index", object: 1 },
		]);
	});
});
