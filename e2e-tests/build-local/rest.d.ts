import type { Context } from "@haibun/web-server-hono/defs.js";
import type TestServer from "./test-server.js";
type TRouteHandler = (c: Context) => Response | Promise<Response>;
/**
 * REST route handlers for test server.
 * These don't include auth checks - auth is applied via middleware at route registration.
 */
export declare const restRoutes: (testServer: TestServer) => Record<string, TRouteHandler>;
export {};
//# sourceMappingURL=rest.d.ts.map