import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import type { MiddlewareHandler } from 'hono';
import type { IEventLogger } from '@haibun/core/lib/EventLogger.js';
import {
  type IWebServer, type TRouteMap, type TRouteTypes,
  type TRequestHandler, type TStaticFolderOptions, ROUTE_TYPES,
} from './defs.js';

const DEFAULT_MOUNTED = (): TRouteMap =>
  ROUTE_TYPES.reduce((acc, type) => ({ ...acc, [type]: {} }), {} as TRouteMap);

export class ServerHono implements IWebServer {
  private static listeningPorts: number[] = [];
  private server?: ServerType;
  private readonly _app: Hono;
  private _mounted: TRouteMap = DEFAULT_MOUNTED();
  private _port?: number;

  constructor(private readonly eventLogger: IEventLogger, private readonly base: string) {
    this._app = new Hono();
  }

  get app(): Hono { return this._app; }
  get mounted(): TRouteMap { return this._mounted; }
  get port(): number | undefined { return this._port; }

  use(middleware: MiddlewareHandler): void { this._app.use(middleware); }

  async listen(port: number): Promise<void> {
    if (typeof port !== 'number' || Number.isNaN(port) || port <= 0) {
      throw new Error(`ServerHono.listen: invalid port "${port}"`);
    }
    if (ServerHono.listeningPorts.includes(port)) {
      this.eventLogger.info(`ServerHono already listening on port ${port}`);
      return;
    }
    return new Promise((resolve, reject) => {
      try {
        this.server = serve({ fetch: this._app.fetch, port }, () => {
          this._port = port;
          ServerHono.listeningPorts.push(port);
          this.eventLogger.debug?.(`ServerHono listening on port ${port}`);
          resolve();
        });
      } catch (e) {
        reject(new Error(`ServerHono.listen: failed on port ${port}: ${e instanceof Error ? e.message : e}`));
      }
    });
  }

  async close(): Promise<void> {
    if (this.server) {
      this.eventLogger.debug?.(`ServerHono closing on port ${this._port}`);
      this.server.close();
      if (this._port !== undefined) {
        ServerHono.listeningPorts = ServerHono.listeningPorts.filter(p => p !== this._port);
      }
      this.server = undefined;
      this._mounted = DEFAULT_MOUNTED();
    }
  }

  addRoute(type: TRouteTypes, path: string, ...handlers: TRequestHandler[]): void {
    this.validateRouteType(type);
    this.validatePath(path);
    this.ensureNotMounted(type, path);
    this.eventLogger.debug?.(`ServerHono: adding ${type} route at ${path}`);
    this.registerRoute(type, path, handlers);
    this.markMounted(type, path, handlers.toString());
  }

  addKnownRoute(type: TRouteTypes, path: string, ...handlers: TRequestHandler[]): void {
    this.validateRouteType(type);
    this.eventLogger.debug?.(`ServerHono: adding known ${type} route at ${path}`);
    this.registerRoute(type, path, handlers);
    this.markMounted(type, path, handlers.toString());
  }

  checkAddStaticFolder(relativeFolder: string, mountAt: string, options?: TStaticFolderOptions): void {
    if (!relativeFolder) throw new Error('ServerHono.checkAddStaticFolder: relativeFolder is required');
    if (!mountAt) throw new Error('ServerHono.checkAddStaticFolder: mountAt is required');
    this.addStaticFolderInternal(join(this.base, relativeFolder), mountAt, options);
  }

  addKnownStaticFolder(folder: string, mountAt: string, options?: TStaticFolderOptions): void {
    if (!folder) throw new Error('ServerHono.addKnownStaticFolder: folder is required');
    if (!mountAt) throw new Error('ServerHono.addKnownStaticFolder: mountAt is required');
    this.addStaticFolderInternal(folder, mountAt, options);
  }

  checkAddIndexFolder(relativeFolder: string, mountAt: string): void {
    if (!relativeFolder) throw new Error('ServerHono.checkAddIndexFolder: relativeFolder is required');
    if (!mountAt) throw new Error('ServerHono.checkAddIndexFolder: mountAt is required');
    const folder = join(this.base, relativeFolder);
    this.ensureNotMounted('get', mountAt);
    this.validateFolderExists(folder);
    this.eventLogger.debug?.(`ServerHono: serving index from ${folder} at ${mountAt}`);

    const indexPath = mountAt.endsWith('/') ? `${mountAt}*` : `${mountAt}/*`;
    this._app.get(indexPath, async (c) => {
      const requestPath = c.req.path.replace(mountAt, '').replace(/^\//, '');
      const fullPath = join(folder, requestPath);
      if (!existsSync(fullPath)) return c.notFound();
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const files = readdirSync(fullPath);
        return c.html(this.generateDirectoryListing(requestPath || '/', files, mountAt));
      }
      let notFoundCalled = false;
      const response = await serveStatic({ root: folder })(c, async () => { notFoundCalled = true; });
      return notFoundCalled || !response ? c.notFound() : response;
    });
    this.markMounted('get', mountAt, folder);
  }

  private addStaticFolderInternal(folder: string, mountAt: string, options?: TStaticFolderOptions): void {
    this.validatePath(mountAt);
    this.ensureNotMounted('get', mountAt);
    this.validateFolderExists(folder);
    this.eventLogger.debug?.(`ServerHono: serving static files from ${folder} at ${mountAt}`);
    const staticPath = mountAt.endsWith('/') ? `${mountAt}*` : `${mountAt}/*`;
    this._app.get(staticPath, serveStatic({ root: folder, rewriteRequestPath: path => path.replace(mountAt, '') }));
    this._app.get(mountAt, serveStatic({ root: folder, rewriteRequestPath: () => '/index.html' }));
    this.markMounted('get', mountAt, folder);
  }

  private validateRouteType(type: TRouteTypes): void {
    if (!ROUTE_TYPES.includes(type)) throw new Error(`ServerHono: invalid route type "${type}"`);
  }

  private validatePath(path: string): void {
    const sanitized = path.replace(/[^a-zA-Z0-9/\-:_]/g, '').replace(/:(?![a-zA-Z0-9_-])/g, '');
    if (path !== sanitized) throw new Error(`ServerHono: path "${path}" has illegal characters`);
  }

  private ensureNotMounted(type: TRouteTypes, path: string): void {
    const alreadyMounted = this._mounted[type][path] ||
      Object.keys(this._mounted[type]).find((m: string) => m.startsWith(`${path}/`));
    if (alreadyMounted) throw new Error(`ServerHono: cannot mount ${type} at "${path}" - already mounted`);
  }

  private validateFolderExists(folder: string): void {
    if (!existsSync(folder)) throw new Error(`ServerHono: folder "${folder}" doesn't exist`);
    if (!statSync(folder).isDirectory()) throw new Error(`ServerHono: "${folder}" is not a directory`);
  }

  private registerRoute(type: TRouteTypes, path: string, handlers: TRequestHandler[]): void {
    this._app[type](path, ...handlers);
  }

  private markMounted(type: TRouteTypes, path: string, what: string): void {
    this._mounted[type][path] = what;
  }

  private generateDirectoryListing(dirPath: string, files: string[], mountAt: string): string {
    const items = files.map(file => {
      const href = `${mountAt}/${dirPath}/${file}`.replace(/\/+/g, '/');
      return `<li><a href="${href}">${file}</a></li>`;
    }).join('\n');
    return `<!DOCTYPE html><html><head><title>Index of ${dirPath}</title></head><body><h1>Index of ${dirPath}</h1><ul>${items}</ul></body></html>`;
  }
}

export const DEFAULT_PORT = 8123;
