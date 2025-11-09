import { IRequest, IResponse } from '@haibun/web-server-express/defs.js';
import TestServer from './test-server.js';
export type TSchemeType = 'basic' | 'bearer';
type TSchemeMethods = (testServer: TestServer) => {
    check: (req: IRequest, res: IResponse) => boolean;
    logout: () => void;
};
export type TAuthScheme = {
    [K in TSchemeType]: TSchemeMethods;
};
export declare const authSchemes: TAuthScheme;
export {};
