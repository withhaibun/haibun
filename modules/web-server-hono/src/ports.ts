/**
 * The ports of the web server: the server where other steppers mount routes and `/rpc` method families, and the
 * authority that each of its requests presents. Other packages read the server through this module, as
 * `@haibun/web-server-hono/defs.js`.
 */
import { z } from "zod";
import type { Context, MiddlewareHandler, Hono } from "hono";
import { ENDPOINT_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SIGNATURE_HEADER } from "@haibun/core/lib/domains/signature-header.js";
import type { IRouteRegistry } from "@haibun/core/lib/execution.js";
import type { TRpcMethod } from "@haibun/core/lib/rpc-wire.js";
import type { TRestsOn } from "@haibun/core/lib/domains/authority-types.js";

export type { Context, MiddlewareHandler, Hono };

/** The runtime key that holds the web server of the feature in progress. */
export const WEBSERVER = "webserver";

export const RouteTypeSchema = z.enum(["get", "post", "put", "delete", "head", "options"]);
export type TRouteTypes = z.infer<typeof RouteTypeSchema>;
export const ROUTE_TYPES = RouteTypeSchema.options;

export type TRouteMap = { [K in TRouteTypes]: { [path: string]: string } };
export type TRequestHandler = (c: Context) => Response | Promise<Response>;

/** A path parameter the route's pattern names, which every request the route matched holds. */
export function pathParam(c: Context, name: string): string {
	const value = c.req.param(name);
	if (value === undefined) throw new Error(`the route that matched ${c.req.path} doesn't name a path parameter ${name}`);
	return value;
}

/** The purpose of a route, stated as it is mounted. A route without a purpose isn't mounted, since the graph's endpoints
 *  and the show endpoints view render from it. */
export type TRoutePurpose = {
	/** The purpose in words, such as "OID4VCI issuer metadata". */
	description: string;
	/** Set on a service route of the app (/rpc, /sse), which its endpoint records as a service rather than a page route. */
	service?: true;
};

/** The type of the record that persists each mounted route, which an observed HTTP request edges toward. */
export const EndpointLabels = { Endpoint: ENDPOINT_LABEL } as const;

/** The most a request's body may hold, which the server refuses before it reads more: a file a person keeps travels as a
 *  data address inside a call, so the limit is set by the files a deployment keeps, not by a step's arguments. */
export const REQUEST_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

/** Whether a host name or address is this machine's loopback. */
export const isLoopback = (host: string): boolean => host === "localhost" || host === "::1" || host === "[::1]" || IPV4_LOOPBACK.test(host);
/** An IPv4 address within 127.0.0.0/8. */
const IPV4_LOOPBACK = /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export interface IWebServer extends IRouteRegistry {
	/** Serve the folder `relativeFolder` names under the server's base at `mountAt`, each request for a file it holds passing
	 *  `before` first, such as a middleware that requires an action. */
	checkAddStaticFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void;
	/** Serve an index of the folder `relativeFolder` names under the server's base at `mountAt`, each request for what it holds
	 *  passing `before` first. */
	checkAddIndexFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void;
	/** Serve a folder at `mountAt`, each request for a file it holds passing `before` first, such as a middleware that
	 *  requires an action. */
	addKnownStaticFolder(folder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void;
	/** Listens on `port` at `hostname`, or on this machine's loopback interface where `hostname` is absent. */
	listen(why: string, port: number, hostname?: string): Promise<void>;
	close(): Promise<void>;
	readonly mounted: TRouteMap;
	addRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void;
	addRouteIfAbsent(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void;
	/** Serve a family of `/rpc` methods under `prefix`, which ends in ".", each gated by the action it declares as a step is
	 *  by its capability. A family doesn't add a route: its methods are called over `/rpc`. */
	addRpcMethods(prefix: string, purpose: TRoutePurpose, methods: Record<string, TRpcMethod>): void;
	/** The method of a served family that an `/rpc` call names, if any. */
	rpcMethod(method: string): TRpcMethod | undefined;
	clearMounted(): void;
	/** The actions every caller may take without a delegation, beside what it proves: an empty list, unless the deployment states one. */
	readonly allowedWithoutDelegation: readonly string[];
	use(middleware: MiddlewareHandler): void;
	readonly app: Hono;
	readonly port: number | undefined;
}

/** A request's headers by name, each as it arrived. */
export type TRequestHeaders = Record<string, string | undefined>;

/** What a request carries about itself: a signed presentation covers the method and the address as well as the headers,
 *  and the body as its digest. */
export type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
export const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** The headers a request presenting authority carries: its signature, the capability it invokes, and its body's digest. */
export const PRESENTED_REQUEST_HEADERS = [SIGNATURE_HEADER, PRESENTED_AUTHORITY_HEADER, "digest"] as const;

/** What a server states about its callers: what each may do without a delegation. */
export type TServed = Pick<IWebServer, "allowedWithoutDelegation">;

/** What a request is authorized for, `granted`, and what its caller holds, `held`, which bounds what it reads and is shown.
 *  A proof states who made it, `principal`, and what it rests on, `restsOn`. A presented proof that fails, or that the
 *  runtime can't check, is `refused`, and a refused request doesn't run a step. */
export type TRequestAuthority = { granted: string[]; held: string[]; principal?: string; restsOn?: TRestsOn; refused?: string };

/**
 * The verifier of the authority each request presents to a server: what the request may do and who proved it, a route's
 * refusal of a request whose authority doesn't allow an action, and the watch that ends a call held open once the
 * authority it rests on lapses.
 */
export type TCapabilityVerifier = {
	/** What a request may do, verified over the whole request where it presents a proof. */
	authorityOf(request: TAuthorizedRequest | undefined): Promise<TRequestAuthority>;
	/** A request's authority where it allows `action`, or else the response that refuses it, 403 whether its proof fails or
	 *  its authority doesn't allow the action. */
	allowing(c: Context, action: string): Promise<TRequestAuthority | Response>;
	/** Who a refusal names the lacked action to: a caller whose proof holds a delegation, which can request what it lacks. */
	delegateOf(authority: Pick<TRequestAuthority, "held" | "principal">): string | undefined;
	/** Ends a call held open, through `end`, once a capability its proof rests on is revoked or expires; watching stops when
	 *  `signal` aborts. */
	endWhenLapsed(authority: TRequestAuthority, signal: AbortSignal, end: (reason: string) => void): void;
};

/** Reads the response an address gives a request without a sign-in. */
export type TUnsignedRequest = (address: string) => Promise<Response>;
