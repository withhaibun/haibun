
export const WEBSERVER = 'webserver';
export const CHECK_LISTENER = 'CHECK_LISTENER';
import * as express from 'express';

export interface IWebServer {
  addStaticFolder(subdir: string): Promise<string | undefined>;
  addKnownStaticFolder(subdir: string, mountAt?: string): Promise<string | undefined>;
  listen(): Promise<IWebServer>;
  close(): Promise<void>;
  addRoute(type: TRouteTypes, path: string, route: TRequestHandler): void;
}

export type TRouteTypes = 'get' | 'post';

export type IRequest = typeof express.request;

export type IResponse = typeof express.response;

export type TRequestHandler = (req: IRequest, res: IResponse) => void;
