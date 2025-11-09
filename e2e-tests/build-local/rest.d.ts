import { IRequest, IResponse } from '@haibun/web-server-express/defs.js';
import TestServer from './test-server.js';
export declare const restRoutes: (testServer: TestServer) => {
    createAuthToken(req: IRequest, res: IResponse): Promise<void>;
    checkAuth(req: IRequest, res: IResponse): Promise<void>;
    logOut(req: IRequest, res: IResponse): Promise<void>;
    resourceGet(req: IRequest, res: IResponse): Promise<void>;
    resourceDelete(req: IRequest, res: IResponse): Promise<void>;
    resources(req: IRequest, res: IResponse): Promise<void>;
    logIn(req: IRequest, res: IResponse): Promise<void>;
};
