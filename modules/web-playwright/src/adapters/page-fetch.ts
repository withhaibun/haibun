/** An HTTP request made with `fetch`, and its response as the endpoint returned it: text and JSON where the body is text, or the response's bytes and media type where the body is binary. */
import type { TCapturedResponse, TJsonResponse } from "../domains/web-playwright.js";
import type { TPageFetch } from "../ports.js";

/** Whether a response's media type names text or JSON, rather than binary bytes. */
function isTextMediaType(mediaType: string): boolean {
	if (mediaType === "") return true;
	if (mediaType.startsWith("text/")) return true;
	if (mediaType === "application/json" || mediaType.endsWith("+json")) return true;
	if (mediaType === "application/xml" || mediaType.endsWith("+xml")) return true;
	return (
		mediaType === "application/javascript" ||
		mediaType === "application/x-ndjson" ||
		mediaType === "application/n-quads" ||
		mediaType === "application/n-triples" ||
		mediaType === "application/x-www-form-urlencoded"
	);
}

/** Whether `headers` already sets an Accept header, regardless of case. */
const hasAcceptHeader = (headers: Record<string, string>): boolean => Object.keys(headers).some((key) => key.toLowerCase() === "accept");

export const fetchInPage: TPageFetch = async (request) => {
	const { endpoint, method, headers, postData } = request;
	const requestHeaders = hasAcceptHeader(headers) ? headers : { accept: "*/*", ...headers };
	try {
		const response = await fetch(endpoint, { method: method.toUpperCase(), headers: requestHeaders, ...(postData === undefined ? {} : { body: postData }) });
		const responseHeaders = Object.fromEntries(response.headers.entries());
		const rawContentType = response.headers.get("content-type");
		const contentType = rawContentType === null ? "" : rawContentType;
		const firstPart = contentType.split(";")[0];
		const mediaType = firstPart === undefined ? "" : firstPart.trim().toLowerCase();
		if (!isTextMediaType(mediaType)) {
			const bytes = Buffer.from(await response.arrayBuffer());
			const captured: TCapturedResponse = {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders,
				url: response.url || endpoint,
				text: "",
				...(bytes.byteLength > 0 ? { encodingFormat: mediaType } : {}),
			};
			return bytes.byteLength > 0 ? { captured, bytes, mediaType } : { captured };
		}
		// A text body is read once, as its text, and read again as JSON where it is JSON.
		const text = await response.text();
		let json: TJsonResponse | undefined;
		try {
			json = JSON.parse(text) as TJsonResponse;
		} catch {
			// A body that isn't JSON is its text alone.
		}
		const captured: TCapturedResponse = {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
			url: response.url || endpoint,
			text,
			...(json === undefined ? {} : { json }),
		};
		return { captured };
	} catch (e) {
		throw new Error(`the fetch of ${method} ${endpoint} failed: ${e instanceof Error ? e.message : String(e)}`);
	}
};
