/**
 * The web server's domain: the port it serves on where a configuration doesn't state one, the endpoint each mounted route
 * is recorded as, the ports this process listens on, and what holding authority over the server means. It also states the
 * runtime key that holds the server, the route types, a route's path parameter, the most a request's body holds, the
 * loopback addresses, the origins a server is reached at and the hosts it serves, and the headers of a request that
 * presents authority.
 */
import { z } from "zod";
import type { Context } from "hono";
import { ENDPOINT_CLASS, ENDPOINT_LABEL, PersistedVertexSchema } from "@haibun/core/lib/domains/resources.js";
import { MODULE_OPTION_PREFIX } from "@haibun/core/lib/domains/protocol.js";
import { SIGNATURE_HEADER } from "@haibun/core/lib/domains/signature-header.js";
import { isDev, PRODUCTION } from "@haibun/core/lib/domains/dev-mode.js";
import { namedOrigin } from "@haibun/core/lib/request-context.js";

/** The port the web server listens on where its PORT option isn't set. */
export const DEFAULT_PORT = 8123;

/** The name of the web server's stepper, which prefixes its options. */
export const WEB_SERVER_STEPPER = "WebServerStepper";
/** The web server's PORT option, which a stepper that shares the server's port reads. */
export const WEB_SERVER_PORT_OPTION = `${MODULE_OPTION_PREFIX}${WEB_SERVER_STEPPER.toUpperCase()}_PORT`;
/** The web server's ORIGINS option: each address the server is reached at, with its scheme, comma-separated. */
export const WEB_SERVER_ORIGINS_OPTION = `${MODULE_OPTION_PREFIX}${WEB_SERVER_STEPPER.toUpperCase()}_ORIGINS`;

/** What the ORIGINS option holds, and an example, which each refusal of its value states. */
const ORIGINS_HOLD = `${WEB_SERVER_ORIGINS_OPTION} holds each address the server is reached at with its scheme, comma-separated, such as https://example.org or http://localhost:8123`;

/** The origins an ORIGINS value names. Throws, naming the entry, where an entry isn't an http or https origin. */
export function originList(input: string): string[] {
	return input
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => {
			const url = URL.canParse(entry) ? new URL(entry) : undefined;
			if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== entry.replace(/\/$/, "")) throw new Error(`"${entry}" isn't an origin. ${ORIGINS_HOLD}.`);
			return url.origin;
		});
}

/** The refusal to start a server in production that doesn't name its origins. */
export const ORIGINS_REQUIRED = `${WEB_SERVER_ORIGINS_OPTION} isn't set, and in production (NODE_ENV=${PRODUCTION}) a server serves only the hosts of the origins it names. ${ORIGINS_HOLD}.`;

/** The host a request is addressed to, without its port, or undefined where its `Host` header is absent or doesn't parse. */
const addressedHost = (host: string | undefined): string | undefined => (host && URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : undefined);

/**
 * Whether a server reached at `origins` serves a request addressed to `host`: the host of one of its origins, or, in
 * development, a loopback name. A page another site serves can rebind its own name to this machine's address, and its
 * requests then reach the server as same-origin requests addressed to that name, so the name a request is addressed to
 * shows whether it was sent for this server.
 */
export function admitsHost(origins: readonly string[], host: string | undefined): boolean {
	if (namedOrigin(origins, host) !== undefined) return true;
	const addressed = addressedHost(host);
	return isDev() && addressed !== undefined && isLoopback(addressed);
}

/** Whether a page at `origin` may call a server reached at `origins` across origins: one of its origins, or, in
 *  development, a page at a loopback address. */
export const admitsOrigin = (origins: readonly string[], origin: string): boolean =>
	origins.includes(origin) || (isDev() && URL.canParse(origin) && isLoopback(new URL(origin).hostname));

/** The refusal of a request addressed to a host the server doesn't serve, naming the hosts it serves and the remedy. */
export function misdirected(origins: readonly string[], host: string | undefined): string {
	const served = [...(isDev() ? ["localhost", "127.0.0.1", "[::1]"] : []), ...origins.map((origin) => new URL(origin).host)];
	const addressed = host === undefined ? "an unnamed host" : host;
	return `This server serves requests addressed to ${served.join(", ")}, and this one is addressed to ${addressed}. Open it at one of those, or name its address in ${WEB_SERVER_ORIGINS_OPTION}.`;
}

/** The record a mounted route is persisted as, so an observed HTTP request can edge to the endpoint it reached.
 *  `endpointClass` distinguishes a page route from service plumbing (/rpc, /sse). */
export const EndpointSchema = PersistedVertexSchema.extend({
	url: z.string(),
	method: z.string(),
	description: z.string(),
	endpointClass: z.enum([ENDPOINT_CLASS.route, ENDPOINT_CLASS.service]).optional(),
	generatedAtTime: z.coerce.date(),
});
export type TEndpoint = z.infer<typeof EndpointSchema>;
export const DOMAIN_ENDPOINT = "haibun-endpoint";

/** What holding authority over this instance's web server means: ending the process that serves it. */
export const WEB_SERVER_CAPABILITIES = { stop: "WebServer:stop" } as const;

/**
 * The refusal of a call that requests a read where its step doesn't declare itself one. Actuality holds a call to the
 * step's own declaration, so a reading isn't recorded as something actuality did. It is checked after the gate, so only
 * a call its caller may make is refused this way, on every transport.
 */
export const notARead = (method: string): string =>
	`${method} was called as a read, and does not declare itself one: a read doesn't leave a record, so declare read: true on a step a page reads`;

/** The refusal of a call at a seqPath where a call is running: the two would allocate the same paths under it. */
export const callAtRunningPath = (method: string, seqPath: number[]): string =>
	`${method} was called at seqPath ${seqPath.join(".")}, where a call is running: a call states a seqPath of its own, or omits it so this host allocates one`;

/** The runtime key that holds the web server of the feature in progress. */
export const WEBSERVER = "webserver";

export const RouteTypeSchema = z.enum(["get", "post", "put", "delete", "head", "options"]);
export type TRouteTypes = z.infer<typeof RouteTypeSchema>;
export const ROUTE_TYPES = RouteTypeSchema.options;

/** A path parameter the route's pattern names, which every request the route matched holds. */
export function pathParam(c: Context, name: string): string {
	const value = c.req.param(name);
	if (value === undefined) throw new Error(`the route that matched ${c.req.path} doesn't name a path parameter ${name}`);
	return value;
}

/** The type of the record that persists each mounted route, which an observed HTTP request edges toward. */
export const EndpointLabels = { Endpoint: ENDPOINT_LABEL } as const;

/** The most a request's body may hold, which the server refuses before it reads more: a file a person keeps travels as a
 *  data address inside a call, so the limit is set by the files a deployment keeps, not by a step's arguments. */
export const REQUEST_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

/** Whether a host name or address is this machine's loopback. */
export const isLoopback = (host: string): boolean => host === "localhost" || host === "::1" || host === "[::1]" || IPV4_LOOPBACK.test(host);
/** An IPv4 address within 127.0.0.0/8. */
const IPV4_LOOPBACK = /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
export const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** The headers a request presenting authority carries: its signature, the capability it invokes, and its body's digest. */
export const PRESENTED_REQUEST_HEADERS = [SIGNATURE_HEADER, PRESENTED_AUTHORITY_HEADER, "digest"] as const;
