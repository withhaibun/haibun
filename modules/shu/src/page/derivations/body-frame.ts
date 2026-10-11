/**
 * The document that renders a record's body inside a sandboxed frame. A markdown or plain body doesn't read from the
 * network; an HTML body opts out of the policy, and the frame's sandbox still blocks its scripts.
 */
import { MEDIA_TYPE } from "@haibun/core/lib/media-types.js";
import { BODY_READING_STYLE, escAttr } from "./markdown.js";

/** The policy of a body that doesn't read from the network. `base-uri` admits the app's origin, or the policy discards the
 *  `<base>` by which the body's links work. */
const bodyCsp = (baseOrigin: string | undefined): string =>
	`default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri ${baseOrigin === undefined ? "'none'" : baseOrigin}; form-action 'none'`;

/** Returns the document of a body: `content` of `mediaType`, with links resolved against the page at `pageUrl`. */
export function buildBodyIframeDoc(content: string, mediaType: string, pageUrl: string | undefined): string {
	const baseOrigin = pageUrl === undefined ? undefined : new URL(pageUrl).origin;
	const csp = mediaType === MEDIA_TYPE.html ? "" : `<meta http-equiv="Content-Security-Policy" content="${bodyCsp(baseOrigin)}">`;
	// In a data: document a `#` link resolves against the data: URL and doesn't navigate; the base roots links in the app,
	// and target=_top sends them to the top frame, which the frame's sandbox permits for a reader's navigation.
	const base = pageUrl === undefined ? "" : `<base href="${escAttr(pageUrl)}" target="_top">`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8">${csp}${base}<style>body{${BODY_READING_STYLE}margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
}
