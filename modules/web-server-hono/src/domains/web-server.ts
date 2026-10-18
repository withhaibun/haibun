/**
 * The web server's domain: the port it serves on where a configuration doesn't state one, the endpoint each mounted route
 * is recorded as, the ports this process listens on, and what holding authority over the server means. It also states the
 * runtime key that holds the server, the route types, a route's path parameter, the most a request's body holds, the
 * loopback addresses, and the headers of a request that presents authority.
 */
import { z } from "zod";
import type { Context } from "hono";
import { ENDPOINT_CLASS, ENDPOINT_LABEL, PersistedVertexSchema } from "@haibun/core/lib/domains/resources.js";
import { MODULE_OPTION_PREFIX } from "@haibun/core/lib/domains/protocol.js";
import { SIGNATURE_HEADER } from "@haibun/core/lib/domains/signature-header.js";

/** The port the web server listens on where its PORT option isn't set. */
export const DEFAULT_PORT = 8123;

/** The name of the web server's stepper, which prefixes its options. */
export const WEB_SERVER_STEPPER = "WebServerStepper";
/** The web server's PORT option, which a stepper that shares the server's port reads. */
export const WEB_SERVER_PORT_OPTION = `${MODULE_OPTION_PREFIX}${WEB_SERVER_STEPPER.toUpperCase()}_PORT`;

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

/** The domain of the ports this process listens on, each with why it listens. */
export const DOMAIN_LISTENING_PORTS = "listening-ports";
export const ListeningPortsSchema = z.object({ ports: z.record(z.string(), z.string()) });
export const listeningSummary = (p: Record<string, unknown>) =>
	`listening: ${Object.entries(ListeningPortsSchema.parse(p).ports)
		.map(([port, why]) => `${port} (${why})`)
		.join(", ")}`;

/** What holding authority over this instance's web server means: ending the process that serves it. */
export const WEB_SERVER_CAPABILITIES = { stop: "WebServer:stop" } as const;

/**
 * The refusal of a call that requests a read where its step doesn't declare itself one. Actuality holds a call to the
 * step's own declaration, so a reading isn't recorded as something actuality did. It is checked after the gate, so only
 * a call its caller may make is refused this way, on every transport.
 */
export const notARead = (method: string): string =>
	`${method} was called as a read, and does not declare itself one: a read doesn't leave a record, so declare read: true on a step a page reads`;

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
