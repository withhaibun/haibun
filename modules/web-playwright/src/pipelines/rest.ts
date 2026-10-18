/**
 * Requests made inside the page, with its cookies and the headers a step sets, and the last response, which actuality
 * keeps as JSON text in a variable for the steps that read it.
 */
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { fromJsonText } from "@haibun/core/lib/domains/json-text.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, Origin, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { CapturedResponseSchema, HTTP_METHODS_WITH_BODY, RESPONSE_LISTS, type TCapturedResponse, type TResponseList } from "../domains/web-playwright.js";
import type { TPageFetch } from "../ports.js";
import type { BrowserSession } from "./browser-session.js";

const LAST_REST_RESPONSE = "LAST_REST_RESPONSE";
export const AUTHORIZATION = "Authorization";
const ACCESS_TOKEN = "access_token";
const USER_AGENT = "User-Agent";
const JSON_CONTENT = { "Content-Type": "application/json" };

/** What a request inside the page reads and writes through: the session, the world that keeps the last response, and the page's fetch. */
export type TRestContext = { session: BrowserSession; world: TWorld; fetch: TPageFetch };

/** Sets the headers every request of the page's context carries, and holds them for the requests that add a user agent. */
export const setExtraHTTPHeaders = (session: BrowserSession, headers: Record<string, string>): Promise<void> =>
	session.withPage(async (page) => {
		await page.context().setExtraHTTPHeaders(headers);
		session.extraHTTPHeaders = headers;
	});

/** Makes a request inside the page. A user agent a step set travels as a header of this request alone. */
export async function fetchInPage({ session, fetch }: TRestContext, endpoint: string, method: string, request: { headers?: Record<string, string>; postData?: string }) {
	const page = await session.page();
	const agent = session.apiUserAgent;
	if (agent !== undefined) await page.context().setExtraHTTPHeaders({ ...session.extraHTTPHeaders, [USER_AGENT]: agent });
	try {
		const { headers, postData } = request;
		return await fetch(page, { endpoint, method: method.toLowerCase(), headers: headers === undefined ? {} : headers, ...(postData === undefined ? {} : { postData }) });
	} finally {
		if (agent !== undefined) await page.context().setExtraHTTPHeaders(session.extraHTTPHeaders);
	}
}

/** The response a step captured last, where one did. */
export async function lastResponse(world: TWorld): Promise<TCapturedResponse | undefined> {
	const resolved = await world.shared.resolveVariable({ term: LAST_REST_RESPONSE, origin: Origin.var }, undefined, undefined, { secure: true });
	return resolved.value === undefined ? undefined : fromJsonText(CapturedResponseSchema).parse(resolved.value);
}

export const keepResponse = (world: TWorld, response: TCapturedResponse, featureStep: TFeatureStep): Promise<void> =>
	world.shared.setJSON(LAST_REST_RESPONSE, response, Origin.var, featureStep);

/** Makes a request inside the page and keeps its response as the last one. A method that sends a body sends `postData`,
 *  or an empty JSON body where the step omits it. */
export async function request(
	context: TRestContext,
	featureStep: TFeatureStep,
	endpoint: string,
	method: string,
	payload?: { headers?: Record<string, string>; postData?: string },
) {
	const sendsBody = (HTTP_METHODS_WITH_BODY as readonly string[]).includes(method);
	const body = sendsBody && payload?.postData === undefined ? { postData: "", headers: JSON_CONTENT } : {};
	await keepResponse(context.world, await fetchInPage(context, endpoint, method, { ...body, ...payload }), featureStep);
	return OK;
}

/** Requests an OAuth 2.0 access token, and sends it as the bearer of every later request. */
export async function requestToken(context: TRestContext, featureStep: TFeatureStep, endpoint: string): Promise<TActionResult> {
	const response = await fetchInPage(context, endpoint, "GET", {});
	const token = response.json !== undefined && !Array.isArray(response.json) ? response.json[ACCESS_TOKEN] : undefined;
	if (typeof token !== "string")
		return actionNotOK(`${endpoint} returned ${response.status} without an ${ACCESS_TOKEN}. Check the token request's credentials and the endpoint's address.`);
	await setExtraHTTPHeaders(context.session, { [AUTHORIZATION]: `Bearer ${token}` });
	await keepResponse(context.world, response, featureStep);
	return OK;
}

/** Logs out of OAuth 2.0: later requests drop the extra headers. */
export async function logout(context: TRestContext, featureStep: TFeatureStep, endpoint: string): Promise<TActionResult> {
	await setExtraHTTPHeaders(context.session, {});
	await keepResponse(context.world, await fetchInPage(context, endpoint, "GET", {}), featureStep);
	return OK;
}

/** Keeps the members of the last JSON response whose `property` matches `match` as its filtered members. */
export async function filterResponse(world: TWorld, featureStep: TFeatureStep, property: string, match: string): Promise<TActionResult> {
	const last = await lastResponse(world);
	if (last?.json === undefined || !Array.isArray(last.json)) return actionNotOK(`the last response ${JSON.stringify(last)} isn't a JSON list to filter`);
	const filtered = last.json.filter((item) => typeof item[property] === "string" && item[property].match(match) !== null);
	await keepResponse(world, { ...last, filtered }, featureStep);
	return OK;
}

/** The list of the last response a step counts: its JSON body, or the members a filter kept. */
function listOf(last: TCapturedResponse | undefined, list: TResponseList): unknown[] | undefined {
	if (list === RESPONSE_LISTS.filtered) return last?.filtered;
	return Array.isArray(last?.json) ? last.json : undefined;
}

/** Whether a list of the last response holds `length` members. */
export async function responseLengthIs(world: TWorld, list: TResponseList, length: number): Promise<TActionResult> {
	const members = listOf(await lastResponse(world), list);
	if (members === undefined) return actionNotOK(`the last response doesn't hold a ${list} list to count`);
	return members.length === length ? OK : actionNotOK(`Expected ${length}, got ${members.length}`);
}

/** How many members the last JSON response holds. */
export async function responseCount(world: TWorld): Promise<TActionResult> {
	const members = listOf(await lastResponse(world), RESPONSE_LISTS.json);
	if (members === undefined) return actionNotOK("the last response isn't a JSON list to count: a step that makes a request receives one");
	world.eventLogger.info(`lastResponse JSON count is ${members.length}`);
	return actionOKWithProducts({ summary: `JSON response contains ${members.length} items`, details: { count: members.length } });
}

/** Requests `endpoint/{property}` for each filtered member, and requires each response to have `status`. */
export async function requestEachFiltered(context: TRestContext, property: string, method: string, endpoint: string, status: number): Promise<TActionResult> {
	const filtered = (await lastResponse(context.world))?.filtered;
	if (filtered === undefined) return actionNotOK("the last response doesn't hold filtered members: `filter JSON response by` filters them");
	if (!filtered.every((item) => item[property] !== undefined)) return actionNotOK(`Property ${property} not found in all items`);
	for (const item of filtered) {
		const path = `${endpoint}/${String(item[property])}`;
		const response = await fetchInPage(context, path, method, {});
		if (response.status !== status) return actionNotOK(`Expected status ${status} to ${path}, got ${response.status}`);
	}
	return OK;
}

export async function statusIs(world: TWorld, status: number): Promise<TActionResult> {
	const last = await lastResponse(world);
	if (last === undefined) return actionNotOK(`Expected status ${status}, and a response wasn't received`);
	return last.status === status ? OK : actionNotOK(`Expected status ${status}, got ${last.status}`);
}

export async function responsePropertyIs(world: TWorld, property: string, value: string): Promise<TActionResult> {
	const json = (await lastResponse(world))?.json;
	const found = json === undefined || Array.isArray(json) ? undefined : json[property];
	return found === value ? OK : actionNotOK(`Expected lastResponse.json.${property} to be ${value}, got ${JSON.stringify(found)}`);
}

export async function responseTextIs(world: TWorld, value: string): Promise<TActionResult> {
	const text = (await lastResponse(world))?.text;
	return text === value ? OK : actionNotOK(`Expected response to be ${value}, got ${text}`);
}
