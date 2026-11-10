/**
 * The domains of the browser's records that a quantifier ranges over: each host with the count of requests that reached it,
 * each request with its fields, and each page visited, of those that ended by the quantifier's start, up to a page of rows.
 */
import { z } from "zod";
import { HTTP_HOST_LABEL, HTTP_REQUEST_LABEL, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { recordMembers } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { recordFieldsOf } from "@haibun/core/lib/quad-types.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import { VISITED_PAGE_LABEL, WebPlaywrightDomains } from "../domains/web-playwright.js";

/** The declaration of a type of the browser's records. */
function declared(label: string): TDomainDefinition {
	const found = WebPlaywrightDomains.find(({ selectors }) => selectors.includes(label));
	if (found === undefined) throw new Error(`web-playwright doesn't declare ${label}`);
	return found;
}

/** The domain whose members are the records of a type, each with every field it holds, named by the value of its field `named`. */
const tracedMembers = (selector: string, label: string, named: string, description: string): TDomainDefinition => ({
	selectors: [selector],
	schema: z.string().min(1),
	description,
	members: recordMembers(
		declared(label),
		MAX_PAGE_ROWS,
		() => [],
		(record) => ({ ...recordFieldsOf(record), id: String(record[named]) }),
	),
});

export const TRACE_MEMBER_DOMAINS: TDomainDefinition[] = [
	tracedMembers("http-trace hosts", HTTP_HOST_LABEL, "id", "The hosts the browser's requests reached, each with how many requests reached it"),
	tracedMembers("http-trace", HTTP_REQUEST_LABEL, "id", "The browser's requests, each with every field it holds, such as status, durationMs and url"),
	tracedMembers("visited pages", VISITED_PAGE_LABEL, "name", "The pages the browser navigated to, each named by its URL"),
];
