

export interface IWebServer {
  addStaticFolder(subdir: string): Promise<string | undefined>;
  addKnownStaticFolder(subdir: string, mountAt?: string): Promise<string | undefined>;
  listening(port: number): void;
  addRoute(type: TRouteType, path: string, route: TRequestHandler): void;
}

export type TRouteType = 'get';

export type TRequestHandler = (res: any, req: any) => void;