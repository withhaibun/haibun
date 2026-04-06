import type { MiddlewareHandler } from "@haibun/web-server-hono/defs.js";
import type TestServer from "./test-server.js";
export type TSchemeType = "basic" | "bearer";
export declare const createAuthMiddleware: {
	basic: (ts: TestServer) => MiddlewareHandler;
	bearer: (ts: TestServer) => MiddlewareHandler;
};
export declare const createDynamicAuthMiddleware: (ts: TestServer) => MiddlewareHandler;
export interface AuthSchemeLogout {
	logout: () => void;
}
export declare const authSchemes: Record<TSchemeType, (ts: TestServer) => AuthSchemeLogout>;
//# sourceMappingURL=authSchemes.d.ts.map
