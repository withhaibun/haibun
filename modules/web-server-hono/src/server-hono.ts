import { errorDetail } from "@haibun/core/lib/util/index.js";
import { Hono } from "hono";
import { LinearRouter } from "hono/router/linear-router";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import type { MiddlewareHandler } from "hono";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { describePortOccupant } from "@haibun/core/lib/port-occupant.js";
import { ENDPOINT_CLASS, isServicePath } from "@haibun/core/lib/http-observations.js";
import type { IQuadStore } from "@haibun/core/lib/quad-types.js";
import type { TRpcMethod } from "@haibun/core/lib/rpc-wire.js";
import { basicAuth } from "./auth.js";
import type { TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
import { type IWebServer, type TRouteMap, type TRouteTypes, type TRoutePurpose, type TRequestHandler, ROUTE_TYPES, EndpointLabels } from "./defs.js";

const DEFAULT_MOUNTED = (): TRouteMap => ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), {} as TRouteMap);

export class ServerHono implements IWebServer {
	static listeningPorts: Map<number, string> = new Map();
	private servers = new Map<number, ServerType>();
	private _app!: Hono;
	private _mounted: TRouteMap = DEFAULT_MOUNTED();
	/** The `/rpc` method families served, by their prefix. */
	private rpcFamilies = new Map<string, Record<string, TRpcMethod>>();
	private _port?: number;

	constructor(
		private readonly eventLogger: IEventLogger,
		private readonly base: string,
		private readonly getStore: () => IQuadStore,
		readonly allowedWithoutDelegation: readonly string[],
		/** The people every route admits by HTTP basic auth, before anything else reads a request. Empty, the server doesn't ask. */
		private readonly admitted: readonly TBasicAuthUser[] = [],
	) {
		this.createApp();
	}

	private createApp(): void {
		this._app = new Hono({ router: new LinearRouter() });
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
			throw new Error(`ServerHono.listen: invalid port "${port}"`);
		}
		const host = hostname || "127.0.0.1";
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
					void describePortOccupant(port).then((answering) =>
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

	/** What is served goes with the feature that served it: its routes and its `/rpc` method families. */
	private resetMounts(): void {
		this._mounted = DEFAULT_MOUNTED();
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

	checkAddStaticFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddStaticFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddStaticFolder: mountAt is required");
		this.addStaticFolderInternal(join(this.base, relativeFolder), mountAt, purpose);
	}

	addKnownStaticFolder(folder: string, mountAt: string, purpose: TRoutePurpose, ...before: MiddlewareHandler[]): void {
		if (!folder) throw new Error("ServerHono.addKnownStaticFolder: folder is required");
		if (!mountAt) throw new Error("ServerHono.addKnownStaticFolder: mountAt is required");
		this.addStaticFolderInternal(folder, mountAt, purpose, before);
	}

	checkAddIndexFolder(relativeFolder: string, mountAt: string, purpose: TRoutePurpose): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddIndexFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddIndexFolder: mountAt is required");
		this.validatePurpose(purpose);
		const folder = join(this.base, relativeFolder);
		this.ensureNotMounted("get", mountAt);
		this.validateFolderExists(folder);
		this.eventLogger.debug(`ServerHono: serving index from ${folder} at ${mountAt}`);

		const indexPath = mountAt.endsWith("/") ? `${mountAt}*` : `${mountAt}/*`;
		this._app.get(indexPath, async (c) => {
			const requestPath = c.req.path.replace(mountAt, "").replace(/^\//, "");
			const fullPath = join(folder, requestPath);
			if (!existsSync(fullPath)) return c.notFound();
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				const files = readdirSync(fullPath);
				return c.html(this.generateDirectoryListing(requestPath || "/", files, mountAt));
			}
			let notFoundCalled = false;
			const response = await serveStatic({ root: folder })(c, () => {
				notFoundCalled = true;
				return Promise.resolve();
			});
			return notFoundCalled || !response ? c.notFound() : response;
		});
		this.mount("get", mountAt, folder, purpose);
	}

	private addStaticFolderInternal(folder: string, mountAt: string, purpose: TRoutePurpose, before: MiddlewareHandler[] = []): void {
		this.validatePurpose(purpose);
		this.validatePath(mountAt);
		this.ensureNotMounted("get", mountAt);
		this.validateFolderExists(folder);
		this.eventLogger.debug(`ServerHono: serving static files from ${folder} at ${mountAt}`);
		const staticPath = mountAt.endsWith("/") ? `${mountAt}*` : `${mountAt}/*`;
		for (const gate of before) for (const path of [staticPath, mountAt]) this._app.use(path, gate);
		this._app.get(staticPath, serveStatic({ root: folder, rewriteRequestPath: (path) => path.replace(mountAt, "") }));
		this._app.get(mountAt, serveStatic({ root: folder, rewriteRequestPath: () => "/index.html" }));
		this.mount("get", mountAt, folder, purpose);
	}

	private validatePurpose(purpose: TRoutePurpose): void {
		if (!purpose || typeof purpose.description !== "string" || purpose.description.trim() === "") {
			throw new Error("ServerHono: route purpose.description is required (cannot mount an endpoint without a purpose)");
		}
	}

	private validateRouteType(type: TRouteTypes): void {
		if (!ROUTE_TYPES.includes(type)) throw new Error(`ServerHono: invalid route type "${type}"`);
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

	/** Persist the mounted route as an Endpoint vertex: the existing object an observed HttpRequest edges to. `id`
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
				return `<li><a href="${href}">${file}</a></li>`;
			})
			.join("\n");
		return `<!DOCTYPE html><html><head><title>Index of ${dirPath}</title></head><body><h1>Index of ${dirPath}</h1><ul>${items}</ul></body></html>`;
	}
}

export const DEFAULT_PORT = 8123;
