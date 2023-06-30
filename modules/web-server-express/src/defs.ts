
export const WEBSERVER = 'webserver';
export const CHECK_LISTENER = 'CHECK_LISTENER';
import * as express from 'express';

export interface IWebServer {
  checkAddStaticFolder(subdir: string, loc: string): undefined | string ;
  checkAddIndexFolder(subdir: string, loc: string): undefined | string ;
  addKnownStaticFolder(subdir: string, mountAt?: string): undefined | string;
  listen(): Promise<unknown>;
  close(): Promise<void>;
  addRoute(type: TRouteTypes, path: string, route: TRequestHandler): void;
  use(middleware: express.RequestHandler): void;
}

export type TRouteTypes = 'get' | 'post';

export type IRequest = typeof express.request;

export type IResponse = typeof express.response;

export type TRequestHandler = (req: IRequest, res: IResponse) => void;
