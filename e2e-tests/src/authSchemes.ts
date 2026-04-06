import type { MiddlewareHandler } from "@haibun/web-server-hono/defs.js";
import { basicAuth, bearerAuth } from "@haibun/web-server-hono/auth.js";
import type TestServer from "./test-server.js";

export type TSchemeType = "basic" | "bearer";

const isBrowser = (c: { req: { header: (name: string) => string | undefined } }): boolean => {
	const ua = c.req.header("user-agent");
	return !!ua && /Mozilla|Chrome|Safari|Edge|Opera/.test(ua);
};

export const createAuthMiddleware = {
	basic: (ts: TestServer): MiddlewareHandler =>
		basicAuth({
			verifyUser: (username, password, c) => {
				if (isBrowser(c) || !ts.basicAuthCreds) return false;
				return username === ts.basicAuthCreds.username && password === ts.basicAuthCreds.password;
			},
		}),
	bearer: (ts: TestServer): MiddlewareHandler =>
		bearerAuth({
			verifyToken: (token, c) => {
				if (isBrowser(c)) return false;
				return ts.authToken !== undefined && token === ts.authToken;
			},
		}),
};

export const createDynamicAuthMiddleware = (ts: TestServer): MiddlewareHandler => {
	const handlers: Record<TSchemeType, MiddlewareHandler> = {
		basic: createAuthMiddleware.basic(ts),
		bearer: createAuthMiddleware.bearer(ts),
	};
	return async (c, next) => {
		if (!ts.currentAuthScheme) return c.text("Unauthorized", 401);
		return handlers[ts.currentAuthScheme](c, next);
	};
};

export interface AuthSchemeLogout {
	logout: () => void;
}

export const authSchemes: Record<TSchemeType, (ts: TestServer) => AuthSchemeLogout> = {
	basic: (ts) => ({
		logout: () => {
			ts.basicAuthCreds = undefined;
		},
	}),
	bearer: (ts) => ({
		logout: () => {
			ts.authToken = undefined;
		},
	}),
};
