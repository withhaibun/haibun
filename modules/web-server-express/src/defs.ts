export const WEBSERVER = 'webserver';
export const CHECK_LISTENER = 'CHECK_LISTENER';
import * as express from 'express';

export interface IWebServer {
	checkAddStaticFolder(subdir: string, loc: string, options?: TStaticFolderOptions): undefined | string;
	checkAddIndexFolder(subdir: string, loc: string): undefined | string;
	addKnownStaticFolder(subdir: string, mountAt?: string): undefined | string;
	listen(): Promise<unknown>;
	endedFeature(): Promise<void>;
	mounted: TRouteMap;
	addRoute(type: TRouteTypes, path: string, ...routes: TRequestHandler[]): void;
	addKnownRoute(type: TRouteTypes, path: string, ...routes: TRequestHandler[]): void;
	use(middleware: express.RequestHandler): void;
}

export const ROUTE_TYPES = ['get', 'post', 'put', 'delete', 'head', 'options'] as const;

export type TRouteTypes = (typeof ROUTE_TYPES)[number];
export type TRouteMap = { [K in TRouteTypes]: { [path: string]: string } };

export type IRequest = typeof express.request;

export type IResponse = typeof express.response;

export type TRequestHandler = (req: IRequest, res: IResponse, next: () => void) => void;

export type TStaticFolderOptions = {
	setHeaders?: (res, filePath, stat) => void;
};
