/**
 * The web server's domain: the port it serves on where a configuration doesn't state one, the endpoint each mounted route
 * is recorded as, the ports this process listens on, and what holding authority over the server means.
 */
import { z } from "zod";
import { ENDPOINT_CLASS, PersistedVertexSchema } from "@haibun/core/lib/domains/resources.js";
import { MODULE_OPTION_PREFIX } from "@haibun/core/lib/domains/protocol.js";

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
