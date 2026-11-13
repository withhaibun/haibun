/**
 * HTTP requests made with the headers and user agent a step sets, and the last response, which actuality keeps as JSON
 * text in the variable HTTP_RESPONSE, whose status, json, text and contentUrl a feature reads as any variable's fields.
 * A binary response's bytes are saved to storage on disk, and HTTP_RESPONSE holds only the link to that artifact.
 */
import { isImageFormat, MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { extensionForMediaType } from "@haibun/core/lib/domains/media-type-extensions.js";
import { artifactAddress } from "@haibun/core/lib/domains/run-artifact.js";
import { trackOutboundRequest } from "@haibun/core/lib/pipelines/http-observations.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { fromJsonText, RecordsSchema } from "@haibun/core/lib/domains/json-text.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, Origin, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { basicAuthorization, basicAuthUsers } from "@haibun/core/lib/domains/basic-auth.js";
import { counted } from "@haibun/core/lib/domains/hypermedia.js";
import type { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { saveImageArtifact } from "@haibun/domain-storage/pipelines/image-artifact.js";
import { AUTHORIZATION_SCHEMES, CapturedResponseSchema, HTTP_METHODS_WITH_BODY, type TAuthorizationScheme, type TCapturedResponse } from "../domains/web-playwright.js";
import type { TFetchedResponse, TPageFetch } from "../ports.js";
import type { BrowserSession } from "./browser-session.js";

/** The variable that holds the last response a step captured. */
export const HTTP_RESPONSE = "HTTP response";
export const AUTHORIZATION = "Authorization";
const ACCESS_TOKEN = "access_token";
const USER_AGENT = "User-Agent";
const JSON_CONTENT = { "Content-Type": MEDIA_TYPE.json };

/** What an HTTP request reads and writes through: the session, the world that keeps the last response, the storage for binary artifacts, and the fetch port. */
export type TRestContext = { session: BrowserSession; world: TWorld; storage?: AStorage; fetch: TPageFetch };

/** The value of an Authorization header that sends `credentials` under `scheme`. Throws where Basic credentials aren't one user:password. */
export function authorization(scheme: TAuthorizationScheme, credentials: string): string {
	if (scheme === AUTHORIZATION_SCHEMES.bearer) return `${AUTHORIZATION_SCHEMES.bearer} ${credentials}`;
	const [user, ...more] = basicAuthUsers(credentials);
	if (user === undefined || more.length > 0) throw new Error(`Basic credentials name ${more.length + 1} users; state one user:password`);
	return basicAuthorization(user);
}

/** Sets the headers every request carries, and updates the browser context's extra headers when a page is open. */
export async function setExtraHTTPHeaders(session: BrowserSession, headers: Record<string, string>): Promise<void> {
	session.extraHTTPHeaders = headers;
	if (session.hasPage(session.tab)) {
		await session.withPage((page) => page.context().setExtraHTTPHeaders(headers));
	}
}

/** Makes an HTTP request with the extra headers and user agent the session holds, and records the outbound request. */
export async function fetchInPage(
	{ session, world, fetch }: TRestContext,
	endpoint: string,
	method: string,
	request: { headers?: Record<string, string>; postData?: string },
): Promise<TFetchedResponse> {
	const agent = session.apiUserAgent;
	const headers = { ...session.extraHTTPHeaders, ...(agent === undefined ? {} : { [USER_AGENT]: agent }), ...request.headers };
	const fetched = await fetch({ endpoint, method: method.toUpperCase(), headers, ...(request.postData === undefined ? {} : { postData: request.postData }) });
	await trackOutboundRequest(world, { url: fetched.captured.url || endpoint, status: fetched.captured.status, method: method.toUpperCase() });
	return fetched;
}

/** The response a step captured last, where one did. */
export async function lastResponse(world: TWorld): Promise<TCapturedResponse | undefined> {
	const resolved = await world.shared.resolveVariable({ term: HTTP_RESPONSE, origin: Origin.var }, undefined, undefined, { secure: true });
	return resolved.value === undefined ? undefined : fromJsonText(CapturedResponseSchema).parse(resolved.value);
}

export const keepResponse = (world: TWorld, response: TCapturedResponse, featureStep: TFeatureStep): Promise<void> =>
	world.shared.setJSON(HTTP_RESPONSE, response, Origin.var, featureStep);

/** Makes an HTTP request and keeps its response as the last one. A method that sends a body sends `postData`, or an
 *  empty JSON body where the step omits it. When the response body is binary, saves the bytes to storage on disk and
 *  keeps only the artifact's link in HTTP_RESPONSE. */
export async function request(
	context: TRestContext,
	featureStep: TFeatureStep,
	endpoint: string,
	method: string,
	payload?: { headers?: Record<string, string>; postData?: string; saveAs?: string },
): Promise<TActionResult> {
	const sendsBody = (HTTP_METHODS_WITH_BODY as readonly string[]).includes(method);
	const body = sendsBody && payload?.postData === undefined ? { postData: "", headers: JSON_CONTENT } : {};
	const fetched = await fetchInPage(context, endpoint, method, { ...body, ...payload });
	if (fetched.bytes !== undefined && fetched.mediaType !== undefined && context.storage !== undefined) {
		const filename = payload?.saveAs !== undefined ? payload.saveAs : `http-${featureStep.seqPath.join(".")}.${extensionForMediaType(fetched.mediaType)}`;
		const isImage = isImageFormat(fetched.mediaType);
		const saved = isImage
			? await saveImageArtifact(
					context.world,
					context.storage,
					{ seqPath: featureStep.seqPath, in: featureStep.in, source: { path: featureStep.source?.path } },
					filename,
					fetched.bytes,
					fetched.mediaType,
				)
			: await context.storage.saveArtifact(filename, fetched.bytes, "file");
		const contentUrl = artifactAddress(saved.baseRelativePath);
		await keepResponse(context.world, { ...fetched.captured, contentUrl, encodingFormat: fetched.mediaType }, featureStep);
		return OK;
	}
	await keepResponse(context.world, fetched.captured, featureStep);
	return OK;
}

/** Requests an OAuth 2.0 access token, and sends it as the bearer of every later request. */
export async function requestToken(context: TRestContext, featureStep: TFeatureStep, endpoint: string): Promise<TActionResult> {
	const { captured: response } = await fetchInPage(context, endpoint, "GET", {});
	const token = response.json !== undefined && !Array.isArray(response.json) ? response.json[ACCESS_TOKEN] : undefined;
	if (typeof token !== "string")
		return actionNotOK(`${endpoint} returned ${response.status} without an ${ACCESS_TOKEN}. Check the token request's credentials and the endpoint's address.`);
	await setExtraHTTPHeaders(context.session, { [AUTHORIZATION]: authorization(AUTHORIZATION_SCHEMES.bearer, token) });
	await keepResponse(context.world, response, featureStep);
	return OK;
}

/** Logs out of OAuth 2.0: later requests drop the extra headers. */
export async function logout(context: TRestContext, featureStep: TFeatureStep, endpoint: string): Promise<TActionResult> {
	await setExtraHTTPHeaders(context.session, {});
	const { captured } = await fetchInPage(context, endpoint, "GET", {});
	await keepResponse(context.world, captured, featureStep);
	return OK;
}

/** The members of the last JSON response, as a counted list. Refuses a response that isn't a JSON list of members. */
export async function jsonResponse(world: TWorld): Promise<TActionResult> {
	const json = (await lastResponse(world))?.json;
	const members = RecordsSchema.safeParse(json);
	if (!members.success)
		return actionNotOK(`the last response isn't a JSON list of members: a step that makes a request to an endpoint that lists them receives one. It holds ${JSON.stringify(json)}`);
	return actionOKWithProducts({ members: members.data, ...counted(members.data.length) });
}

export async function statusIs(world: TWorld, status: number): Promise<TActionResult> {
	const last = await lastResponse(world);
	if (last === undefined) return actionNotOK(`Expected status ${status}, and a response wasn't received`);
	return last.status === status ? OK : actionNotOK(`Expected status ${status}, got ${last.status}`);
}
