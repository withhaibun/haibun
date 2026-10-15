/**
 * The Hono server of an instance: it listens on its ports, serves the routes, folders and `/rpc` method families mounted
 * on it, and records each mounted route as an endpoint.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { Hono } from "hono";
import { LinearRouter } from "hono/router/linear-router";
import { bodyLimit } from "hono/body-limit";
import { basicAuth } from "hono/basic-auth";
import { every } from "hono/combine";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, statSync, readdirSync } from "fs";
import { resolve, sep } from "path";
import { esc } from "@haibun/core/lib/document-content.js";
import type { IEventLogger, IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { describePortOccupant, PROBE_TIMEOUT_MS } from "@haibun/core/lib/port-occupant.js";
import { ENDPOINT_CLASS, isServicePath } from "@haibun/core/lib/http-observations.js";
import type { TRpcMethod } from "@haibun/core/lib/rpc-wire.js";
import type { TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
import {
	type Context,
	type IWebServer,
	type MiddlewareHandler,
	type TRouteMap,
	type TRouteTypes,
	type TRoutePurpose,
	type TRequestHandler,
	ROUTE_TYPES,
	EndpointLabels,
	isLoopback,
	REQUEST_BODY_LIMIT_BYTES,
} from "../ports.js";

const EMPTY_MOUNTS = (): TRouteMap => ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), {} as TRouteMap);

/** The root path. A folder mounted there shares its addresses with the server's other routes, and an index names its own
 *  mount point by it. */
const ROOT = "/";
/** The file a served folder serves for its own address and for each folder it holds. */
const INDEX_FILE = "index.html";
/** Payload Too Large. */
const TOO_LARGE = 413;
/** Misdirected Request: the request names a host this server doesn't serve. */
const MISDIRECTED = 421;
/** The interface a server listens on where its listener doesn't state one: this machine's loopback. */
const LOOPBACK_INTERFACE = "127.0.0.1";
/** The host a request is addressed to, without its port, or undefined where its `Host` header is absent or doesn't parse. */
const addressedHost = (host: string | undefined): string | undefined => (host && URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : undefined);

export class ServerHono implements IWebServer {
	static listeningPorts: Map<number, string> = new Map();
	private servers = new Map<number, ServerType>();
	private _app!: Hono;
	private _mounted: TRouteMap = EMPTY_MOUNTS();
	/** The `/rpc` method families served, by their prefix. */
	private rpcFamilies = new Map<string, Record<string, TRpcMethod>>();
	private _port?: number;
	/** Whether the server listens only on this machine's loopback interface. */
	private boundToLoopback = false;

	constructor(
		private readonly eventLogger: IEventLogger,
		private readonly base: string,
		private readonly getStore: () => IQuadStore,
		readonly allowedWithoutDelegation: readonly string[],
		/** The people every route admits by HTTP basic auth, before anything else reads a request. Empty, the server admits every visitor. */
		private readonly admitted: readonly TBasicAuthUser[],
	) {
		this.createApp();
	}

	private createApp(): void {
		this._app = new Hono({ router: new LinearRouter() });
		// A server bound to this machine serves only requests addressed to it by a loopback name. A page another site serves
		// can rebind its own name to 127.0.0.1, and its requests then reach this server as same-origin requests addressed to
		// that name, so the name a request is addressed to shows whether it was sent for this machine.
		this._app.use("*", async (c, next) => {
			const host = c.req.header("host");
			const addressed = addressedHost(host);
			if (this.boundToLoopback && (addressed === undefined || !isLoopback(addressed)))
				return c.text(
					`This server serves requests addressed to localhost, 127.0.0.1 or [::1], and this one is addressed to ${host === undefined ? "an unnamed host" : host}. Open it at http://localhost:${this._port}.`,
					MISDIRECTED,
				);
			await next();
		});
		// A body is refused past its limit as it arrives, before a gate reads it whole to check what it proves.
		this._app.use(
			"*",
			bodyLimit({
				maxSize: REQUEST_BODY_LIMIT_BYTES,
				onError: (c) => c.text(`A request's body holds at most ${REQUEST_BODY_LIMIT_BYTES} bytes, and this one holds more.`, TOO_LARGE),
			}),
		);
		const [first, ...others] = this.admitted;
		if (first) this._app.use("*", basicAuth(first, ...others));
	}

	get app(): Hono {
		return this._app;
	}
	get mounted(): TRouteMap {
		return this._mounted;
	}
	get port(): number | undefined {
		return this._port;
	}

	use(middleware: MiddlewareHandler): void {
		this._app.use(middleware);
	}

	listen(why: string, port: number, hostname?: string): Promise<void> {
		if (typeof port !== "number" || Number.isNaN(port) || port <= 0) {
			throw new Error(`ServerHono.listen takes a port above 0, and was given "${port}"; state the port as a whole number above 0`);
		}
		const host = hostname === undefined ? LOOPBACK_INTERFACE : hostname;
		this.boundToLoopback = isLoopback(host);
		if (ServerHono.listeningPorts.has(port)) {
			return Promise.reject(`ServerHono.listen for ${why}: port ${port} (${host}) already in use for ${ServerHono.listeningPorts.get(port)}`);
		}
		return new Promise((resolve, reject) => {
			try {
				const server = serve({ fetch: (req, env) => this._app.fetch(req, env), port, hostname: host }, () => {
					this._port = port;
					this.servers.set(port, server);
					ServerHono.listeningPorts.set(port, why);
					this.eventLogger.debug(`ServerHono listening on port ${port} (${host})`);
					resolve();
				});
				server.on("error", (e: Error) => {
					// A failed bind names the occupant where it can: "EADDRINUSE" alone reads as a dead server, when the
					// situation is a held port and the recourse is to stop what holds it or serve elsewhere.
					void describePortOccupant(port, PROBE_TIMEOUT_MS).then((answering) =>
						reject(new Error(`ServerHono.listen: failed on port ${port} (${host}): ${e.message}${answering ? `, ${answering}` : ""}`)),
					);
				});
			} catch (e) {
				reject(new Error(`ServerHono.listen: failed on port ${port} (${host}): ${errorDetail(e)}`));
			}
		});
	}

	clearMounted(): void {
		if (this.servers.size > 0) {
			throw new Error("ServerHono.clearMounted: cannot clear while server is listening, close() first");
		}
		this.resetMounts();
	}

	close(): Promise<void> {
		if (this.servers.size > 0) {
			for (const [port, server] of this.servers) {
				this.eventLogger.debug(`ServerHono closing on port ${port}`);
				server.close();
				ServerHono.listeningPorts.delete(port);
			}
			this.servers.clear();
			this._port = undefined;
			this.resetMounts();
		}
		return Promise.resolve();
	}

	/** What is served ends with the feature that served it: its routes and its `/rpc` method families. */
	private resetMounts(): void {
		this._mounted = EMPTY_MOUNTS();
		this.rpcFamilies.clear();
		this.createApp();
	}

	addRpcMethods(prefix: string, purpose: TRoutePurpose, methods: Record<string, TRpcMethod>): void {
		this.validatePurpose(purpose);
		if (!prefix.endsWith(".")) throw new Error(`ServerHono.addRpcMethods: a family's prefix ends in ".", not "${prefix}"`);
		if (this.rpcFamilies.has(prefix)) throw new Error(`ServerHono.addRpcMethods: the ${prefix} family is already served`);
		this.rpcFamilies.set(prefix, methods);
		this.persistEndpoint("post", `/rpc/${prefix}*`, purpose);
	}

	rpcMethod(method: string): TRpcMethod | undefined {
		for (const [prefix, methods] of this.rpcFamilies) {
			const name = method.slice(prefix.length);
			if (method.startsWith(prefix) && Object.hasOwn(methods, name)) return methods[name];
		}
		return undefined;
	}

	addRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void {
		this.validatePurpose(purpose);
		this.validateRouteType(type);
		this.validatePath(path);
		this.ensureNotMounted(type, path);
		this.eventLogger.debug(`ServerHono: adding ${type} route at ${path} (${purpose.description})`);
		this.registerRoute(type, path, handlers);
		this.mount(type, path, handlers.toString(), purpose);
	}

	/** Idempotent mount: no-op if the exact path is already mounted for the method. Use for
	 *  routes that may legitimately be registered by repeated step invocations within a feature. */
	addRouteIfAbsent(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void {
		if (this._mounted[type]?.[path]) return;
		this.addRoute(type, path, purpose, ...handlers);
	}

	checkAddStaticFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddStaticFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddStaticFolder: mountAt is required");
		this.addStaticFolderInternal(withinFolder(this.base, relativeFolder), mountAt, purpose, before);
	}

	addKnownStaticFolder(folder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void {
		if (!folder) throw new Error("ServerHono.addKnownStaticFolder: folder is required");
		if (!mountAt) throw new Error("ServerHono.addKnownStaticFolder: mountAt is required");
		this.addStaticFolderInternal(folder, mountAt, purpose, before);
	}

	checkAddIndexFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddIndexFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddIndexFolder: mountAt is required");
		this.validatePurpose(purpose);
		const folder = withinFolder(this.base, relativeFolder);
		this.ensureNotMounted("get", mountAt);
		this.validateFolderExists(folder);
		this.eventLogger.debug(`ServerHono: serving index from ${folder} at ${mountAt}`);

		const indexPath = mountAt.endsWith("/") ? `${mountAt}*` : `${mountAt}/*`;
		const relativeOf = (c: Context) => c.req.path.replace(mountAt, "").replace(/^\//, "");
		this._app.get(
			indexPath,
			forHeld(mountAt, (c) => holds(folder, relativeOf(c), undefined), before),
			async (c) => {
				const requestPath = relativeOf(c);
				const fullPath = resolve(folder, requestPath);
				if (!isWithin(folder, fullPath) || !existsSync(fullPath)) return c.notFound();
				const stat = statSync(fullPath);
				if (stat.isDirectory()) {
					const files = readdirSync(fullPath);
					return c.html(this.generateDirectoryListing(requestPath === "" ? ROOT : requestPath, files, mountAt));
				}
				let notFoundCalled = false;
				const response = await serveStatic({ root: folder })(c, () => {
					notFoundCalled = true;
					return Promise.resolve();
				});
				return notFoundCalled || !response ? c.notFound() : response;
			},
		);
		this.mount("get", mountAt, folder, purpose);
	}

	private addStaticFolderInternal(folder: string, mountAt: string, purpose: TRoutePurpose, before: MiddlewareHandler[]): void {
		this.validatePurpose(purpose);
		this.validatePath(mountAt);
		this.ensureNotMounted("get", mountAt);
		this.validateFolderExists(folder);
		this.eventLogger.debug(`ServerHono: serving static files from ${folder} at ${mountAt}`);
		const staticPath = mountAt.endsWith("/") ? `${mountAt}*` : `${mountAt}/*`;
		const relativeOf = (path: string) => path.replace(mountAt, "");
		this._app.get(
			staticPath,
			forHeld(mountAt, (c) => holds(folder, relativeOf(c.req.path), INDEX_FILE), before),
			serveStatic({ root: folder, rewriteRequestPath: relativeOf }),
		);
		this._app.get(
			mountAt,
			forHeld(mountAt, () => holds(folder, INDEX_FILE, INDEX_FILE), before),
			serveStatic({ root: folder, rewriteRequestPath: () => `/${INDEX_FILE}` }),
		);
		this.mount("get", mountAt, folder, purpose);
	}

	private validatePurpose(purpose: TRoutePurpose): void {
		if (!purpose || typeof purpose.description !== "string" || purpose.description.trim() === "") {
			throw new Error("ServerHono: route purpose.description is required (cannot mount an endpoint without a purpose)");
		}
	}

	private validateRouteType(type: TRouteTypes): void {
		if (!ROUTE_TYPES.includes(type)) throw new Error(`ServerHono doesn't serve a route of the method "${type}"; serve one of ${ROUTE_TYPES.join(", ")}`);
	}

	private validatePath(path: string): void {
		const sanitized = path.replace(/[^a-zA-Z0-9/\-:_.]/g, "").replace(/:(?![a-zA-Z0-9_-])/g, "");
		if (path !== sanitized) throw new Error(`ServerHono: path "${path}" has illegal characters`);
		if (/\.\./g.test(path)) throw new Error(`ServerHono: path "${path}" has multiple dots`);
	}

	private ensureNotMounted(type: TRouteTypes, path: string): void {
		const alreadyMounted = this._mounted[type][path] || Object.keys(this._mounted[type]).find((m: string) => m.startsWith(`${path}/`));
		if (alreadyMounted) throw new Error(`ServerHono: cannot mount ${type} at "${path}" - already mounted`);
	}

	private validateFolderExists(folder: string): void {
		if (!existsSync(folder)) throw new Error(`ServerHono: folder "${folder}" doesn't exist`);
		if (!statSync(folder).isDirectory()) throw new Error(`ServerHono: "${folder}" is not a directory`);
	}

	private registerRoute(type: TRouteTypes, path: string, [handler, ...more]: TRequestHandler[]): void {
		if (!handler) throw new Error(`ServerHono: a ${type} route at "${path}" doesn't have a handler`);
		this._app.on(type.toUpperCase(), path, handler, ...more);
	}

	/** What is served is recorded as its Endpoint, so the graph holds every route the instance serves. */
	private mount(type: TRouteTypes, path: string, what: string, purpose: TRoutePurpose): void {
		this._mounted[type][path] = what;
		this.persistEndpoint(type, path, purpose);
	}

	/** Persist the mounted route as an Endpoint vertex: the existing object that an observed HttpRequest edges toward. `id`
	 *  satisfies the transitory store's default identity field; `url` is the topology's. */
	private persistEndpoint(type: TRouteTypes, path: string, purpose: TRoutePurpose): void {
		const isService = isServicePath(path);
		// fire-and-forget from this sync mount path; a persist failure is a real error and must surface.
		this.getStore()
			.upsertIndividual(EndpointLabels.Endpoint, {
				id: path,
				url: path,
				method: type.toUpperCase(),
				description: purpose.description,
				endpointClass: isService ? ENDPOINT_CLASS.service : ENDPOINT_CLASS.route,
				generatedAtTime: new Date().toISOString(),
			})
			.catch((e) => this.eventLogger.error(`persistEndpoint ${type} ${path}: ${e}`));
	}

	private generateDirectoryListing(dirPath: string, files: string[], mountAt: string): string {
		const items = files
			.map((file) => {
				const href = `${mountAt}/${dirPath}/${file}`.replace(/\/+/g, "/");
				return `<li><a href="${esc(href)}">${esc(file)}</a></li>`;
			})
			.join("\n");
		return `<!DOCTYPE html><html><head><title>Index of ${esc(dirPath)}</title></head><body><h1>Index of ${esc(dirPath)}</h1><ul>${items}</ul></body></html>`;
	}
}

/** Whether `path` is `folder` or under it. */
const isWithin = (folder: string, path: string): boolean => path === resolve(folder) || path.startsWith(`${resolve(folder)}${sep}`);

/** Whether `folder` holds what `relative` names: a file, or a folder, which holds `index` where one is named. */
function holds(folder: string, relative: string, index: string | undefined): boolean {
	const target = resolve(folder, `./${relative}`);
	if (!isWithin(folder, target) || !existsSync(target)) return false;
	return index === undefined || !statSync(target).isDirectory() || existsSync(resolve(target, index));
}

/** `gates` in turn, for each request a folder mounted at `mountAt` serves. A folder mounted elsewhere than the root serves
 *  every address under its mount, held or not, so a gate refuses a caller before the folder shows what it holds. A folder
 *  mounted at the root shares its addresses with the server's other routes, so its gates take only a request for a file
 *  that `held` states it holds, and another request passes them by to the routes after the folder's. */
const forHeld = (mountAt: string, held: (c: Context) => boolean, gates: MiddlewareHandler[]): MiddlewareHandler => {
	const gated = every(...gates);
	return (c, next) => (mountAt !== ROOT || held(c) ? gated(c, next) : next());
};

/** The folder `relative` names under `base`, refused where it leads out of `base`: a feature serves what its base holds. */
export function withinFolder(base: string, relative: string): string {
	const folder = resolve(base, relative);
	if (!isWithin(base, folder)) throw new Error(`ServerHono: ${relative} leads out of ${base}, and a served folder is one the base holds`);
	return folder;
}
