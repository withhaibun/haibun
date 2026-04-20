import { z } from "zod";
import type { Context, MiddlewareHandler, Hono } from "hono";

export type { Context, MiddlewareHandler, Hono };
export const WEBSERVER = "webserver";

export const RouteTypeSchema = z.enum(["get", "post", "put", "delete", "head", "options"]);
export type TRouteTypes = z.infer<typeof RouteTypeSchema>;
export const ROUTE_TYPES = RouteTypeSchema.options;

export const StaticFolderOptionsSchema = z.object({
	headers: z.record(z.string(), z.string()).optional(),
	index: z.boolean().optional(),
});
export type TStaticFolderOptions = z.infer<typeof StaticFolderOptionsSchema>;

export type TRouteMap = { [K in TRouteTypes]: { [path: string]: string } };
export type TRequestHandler = (c: Context) => Response | Promise<Response>;

/** Per-route purpose, required at mount time. Endpoints without a purpose cannot be mounted —
 *  this is what the endpoint-vertex graph and "show endpoints" UI render from. */
export type TRoutePurpose = {
	/** Human-readable purpose, e.g. "OID4VCI issuer metadata" */
	description: string;
};

/** Endpoint graph-vertex type — registered HTTP routes as first-class graph vertices.
 *  WebServerStepper registers this domain so route quads emitted from addRoute land in it. */
export const EndpointSchema = z.object({
	url: z.string(),
	method: z.string().default("GET"),
	description: z.string(),
	registeredAt: z.coerce.date().default(() => new Date()),
});
export type Endpoint = z.infer<typeof EndpointSchema>;
export const EndpointLabels = { Endpoint: "Endpoint" } as const;
export const DOMAIN_ENDPOINT = "haibun-endpoint";

export { registeredPaths } from "@haibun/core/lib/execution.js";
import type { IRouteRegistry } from "@haibun/core/lib/execution.js";

export interface IWebServer extends IRouteRegistry {
	checkAddStaticFolder(relativeFolder: string, mountAt: string, options?: TStaticFolderOptions): void;
	checkAddIndexFolder(relativeFolder: string, mountAt: string): void;
	addKnownStaticFolder(folder: string, mountAt: string, options?: TStaticFolderOptions): void;
	listen(why: string, port: number, hostname?: string): Promise<void>;
	close(): Promise<void>;
	readonly mounted: TRouteMap;
	addRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void;
	addRouteIfAbsent(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void;
	addKnownRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void;
	clearMounted(): void;
	use(middleware: MiddlewareHandler): void;
	readonly app: Hono;
	readonly port: number | undefined;
}
