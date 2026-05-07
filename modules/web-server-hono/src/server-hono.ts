import { Hono } from "hono";
import { LinearRouter } from "hono/router/linear-router";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import type { MiddlewareHandler } from "hono";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { OBSERVATION_GRAPH, SERVICE_PATH_PREFIXES } from "@haibun/core/lib/http-observations.js";
import { emitQuadObservation } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import {
	type IWebServer,
	type TRouteMap,
	type TRouteTypes,
	type TRoutePurpose,
	type TRequestHandler,
	type TStaticFolderOptions,
	ROUTE_TYPES,
	DOMAIN_ENDPOINT,
	EndpointLabels,
} from "./defs.js";

const DEFAULT_MOUNTED = (): TRouteMap => ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), {} as TRouteMap);

export class ServerHono implements IWebServer {
	static listeningPorts: Map<number, string> = new Map();
	private servers = new Map<number, ServerType>();
	private _app!: Hono;
	private _mounted: TRouteMap = DEFAULT_MOUNTED();
	private _port?: number;

	constructor(
		private readonly eventLogger: IEventLogger,
		private readonly base: string,
	) {
		this.createApp();
	}

	private createApp(): void {
		this._app = new Hono({ router: new LinearRouter() });
		this._app.post("/stop", (c) => {
			this.eventLogger.info("Received /stop — shutting down");
			// Defer the signal so the response is fully flushed first. Emitting
			// SIGTERM to self lets every installed shutdown handler run (e.g. a
			// persistent graph store flushing WAL) — `process.exit` would skip them
			// and risk on-disk corruption.
			setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
			return c.json({ stopped: true });
		});
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
					reject(new Error(`ServerHono.listen: failed on port ${port} (${host}): ${e.message}`));
				});
			} catch (e) {
				reject(new Error(`ServerHono.listen: failed on port ${port} (${host}): ${e instanceof Error ? e.message : e}`));
			}
		});
	}

	clearMounted(): void {
		if (this.servers.size > 0) {
			throw new Error("ServerHono.clearMounted: cannot clear while server is listening — close() first");
		}
		this._mounted = DEFAULT_MOUNTED();
		this.createApp();
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
			this._mounted = DEFAULT_MOUNTED();
			this.createApp();
		}
		return Promise.resolve();
	}

	addRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void {
		this.validatePurpose(purpose);
		this.validateRouteType(type);
		this.validatePath(path);
		this.ensureNotMounted(type, path);
		this.eventLogger.debug(`ServerHono: adding ${type} route at ${path} (${purpose.description})`);
		this.registerRoute(type, path, handlers);
		this.markMounted(type, path, handlers.toString());
		this.emitEndpointQuad(type, path, purpose);
	}

	/** Idempotent mount: no-op if the exact path is already mounted for the method. Use for
	 *  routes that may legitimately be registered by repeated step invocations within a feature. */
	addRouteIfAbsent(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void {
		if (this._mounted[type]?.[path]) return;
		this.addRoute(type, path, purpose, ...handlers);
	}

	addKnownRoute(type: TRouteTypes, path: string, purpose: TRoutePurpose, ...handlers: TRequestHandler[]): void {
		this.validatePurpose(purpose);
		this.validateRouteType(type);
		this.eventLogger.debug(`ServerHono: adding known ${type} route at ${path} (${purpose.description})`);
		this.registerRoute(type, path, handlers);
		this.markMounted(type, path, handlers.toString());
	}

	checkAddStaticFolder(relativeFolder: string, mountAt: string, options?: TStaticFolderOptions): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddStaticFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddStaticFolder: mountAt is required");
		this.addStaticFolderInternal(join(this.base, relativeFolder), mountAt, options);
	}

	addKnownStaticFolder(folder: string, mountAt: string, options?: TStaticFolderOptions): void {
		if (!folder) throw new Error("ServerHono.addKnownStaticFolder: folder is required");
		if (!mountAt) throw new Error("ServerHono.addKnownStaticFolder: mountAt is required");
		this.addStaticFolderInternal(folder, mountAt, options);
	}

	checkAddIndexFolder(relativeFolder: string, mountAt: string): void {
		if (!relativeFolder) throw new Error("ServerHono.checkAddIndexFolder: relativeFolder is required");
		if (!mountAt) throw new Error("ServerHono.checkAddIndexFolder: mountAt is required");
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
		this.markMounted("get", mountAt, folder);
	}

	private addStaticFolderInternal(folder: string, mountAt: string, options?: TStaticFolderOptions): void {
		this.validatePath(mountAt);
		this.ensureNotMounted("get", mountAt);
		this.validateFolderExists(folder);
		this.eventLogger.debug(`ServerHono: serving static files from ${folder} at ${mountAt}`);
		const staticPath = mountAt.endsWith("/") ? `${mountAt}*` : `${mountAt}/*`;
		this._app.get(staticPath, serveStatic({ root: folder, rewriteRequestPath: (path) => path.replace(mountAt, "") }));
		this._app.get(mountAt, serveStatic({ root: folder, rewriteRequestPath: () => "/index.html" }));
		this.markMounted("get", mountAt, folder);
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
		const alreadyMounted =
			this._mounted[type][path] || Object.keys(this._mounted[type]).find((m: string) => m.startsWith(`${path}/`));
		if (alreadyMounted) throw new Error(`ServerHono: cannot mount ${type} at "${path}" - already mounted`);
	}

	private validateFolderExists(folder: string): void {
		if (!existsSync(folder)) throw new Error(`ServerHono: folder "${folder}" doesn't exist`);
		if (!statSync(folder).isDirectory()) throw new Error(`ServerHono: "${folder}" is not a directory`);
	}

	private registerRoute(type: TRouteTypes, path: string, handlers: TRequestHandler[]): void {
		(this._app as unknown as Record<string, (...args: unknown[]) => unknown>)[type](path, ...handlers);
	}

	private markMounted(type: TRouteTypes, path: string, what: string): void {
		this._mounted[type][path] = what;
	}

	private emitEndpointQuad(type: TRouteTypes, path: string, purpose: TRoutePurpose): void {
		const isService = SERVICE_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));
		const namedGraph = isService ? OBSERVATION_GRAPH.SERVICE : OBSERVATION_GRAPH.ENDPOINT;
		const timestamp = Date.now();
		const method = type.toUpperCase();
		// Single quad bundles the full endpoint descriptor in `properties`, aligning with
		// WebServerStepper's haibun-endpoint topology (url→identifier, method→tag, description→name, registeredAt→published).
		emitQuadObservation(this.eventLogger, `quad-endpoint-${timestamp}-${type}-${path}`, {
			subject: path,
			predicate: "type",
			object: EndpointLabels.Endpoint,
			namedGraph,
			timestamp,
			properties: {
				domain: DOMAIN_ENDPOINT,
				[LinkRelations.IDENTIFIER.rel]: path,
				[LinkRelations.TAG.rel]: method,
				[LinkRelations.NAME.rel]: purpose.description,
				[LinkRelations.PUBLISHED.rel]: new Date(timestamp).toISOString(),
			},
		});
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
