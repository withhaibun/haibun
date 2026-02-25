import { z } from 'zod';
import type { Context, MiddlewareHandler, Hono } from 'hono';

export type { Context, MiddlewareHandler, Hono };
export const WEBSERVER = 'webserver';

export const RouteTypeSchema = z.enum(['get', 'post', 'put', 'delete', 'head', 'options']);
export type TRouteTypes = z.infer<typeof RouteTypeSchema>;
export const ROUTE_TYPES = RouteTypeSchema.options;

export const StaticFolderOptionsSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  index: z.boolean().optional(),
});
export type TStaticFolderOptions = z.infer<typeof StaticFolderOptionsSchema>;

export type TRouteMap = { [K in TRouteTypes]: { [path: string]: string } };
export type TRequestHandler = (c: Context) => Response | Promise<Response>;

export interface IWebServer {
  checkAddStaticFolder(relativeFolder: string, mountAt: string, options?: TStaticFolderOptions): void;
  checkAddIndexFolder(relativeFolder: string, mountAt: string): void;
  addKnownStaticFolder(folder: string, mountAt: string, options?: TStaticFolderOptions): void;
  listen(why: string, port: number): Promise<void>;
  close(): Promise<void>;
  readonly mounted: TRouteMap;
  addRoute(type: TRouteTypes, path: string, ...handlers: TRequestHandler[]): void;
  addKnownRoute(type: TRouteTypes, path: string, ...handlers: TRequestHandler[]): void;
  use(middleware: MiddlewareHandler): void;
  readonly app: Hono;
  readonly port: number | undefined;
}
