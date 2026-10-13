/**
 * Which of a page's requests its observer records. A request to a host over HTTP is an exchange, and a `blob:` or `data:`
 * URL loads content the page holds. A JSON-RPC call stating `asks: "read"` reads rather than acts, so it doesn't leave a
 * record: actuality doesn't record or narrate it, and the observer doesn't trace or observe it. An observed read returns to
 * the page as a request individual and a host count, and a page that records what it draws then draws what it recorded.
 */
import { fromJsonText } from "@haibun/core/lib/json-text.js";
import { RpcEnvelopeSchema } from "@haibun/core/lib/rpc-wire.js";
import type { TPageRequest } from "../ports.js";

/** The URL schemes of a request that reaches a host. */
const HTTP_SCHEMES = new Set(["http:", "https:"]);
const POST = "POST";
const READ = "read";

/** Returns true where `url` names a request to a host over HTTP. */
export function isHttpExchange(url: string): boolean {
	return HTTP_SCHEMES.has(new URL(url).protocol);
}

/** Returns true for a JSON-RPC call whose envelope states `asks: "read"`. */
export function asksToRead(method: string, postData: string | undefined): boolean {
	if (method !== POST || postData === undefined || postData === "") return false;
	return fromJsonText(RpcEnvelopeSchema).safeParse(postData).data?.asks === READ;
}

/** Returns true for a request the observer records: an HTTP exchange that doesn't read. */
export const isRecorded = ({ url, method, postData }: TPageRequest): boolean => isHttpExchange(url) && !asksToRead(method, postData);
