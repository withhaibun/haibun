import { basicAuth, bearerAuth } from '@haibun/web-server-hono/auth.js';
const isBrowser = (c) => {
    const ua = c.req.header('user-agent');
    return !!ua && /Mozilla|Chrome|Safari|Edge|Opera/.test(ua);
};
export const createAuthMiddleware = {
    basic: (ts) => basicAuth({
        verifyUser: (username, password, c) => {
            if (isBrowser(c) || !ts.basicAuthCreds)
                return false;
            return username === ts.basicAuthCreds.username && password === ts.basicAuthCreds.password;
        },
    }),
    bearer: (ts) => bearerAuth({
        verifyToken: (token, c) => {
            if (isBrowser(c))
                return false;
            return ts.authToken !== undefined && token === ts.authToken;
        },
    }),
};
export const createDynamicAuthMiddleware = (ts) => {
    const handlers = {
        basic: createAuthMiddleware.basic(ts),
        bearer: createAuthMiddleware.bearer(ts),
    };
    return async (c, next) => {
        if (!ts.currentAuthScheme)
            return c.text('Unauthorized', 401);
        return handlers[ts.currentAuthScheme](c, next);
    };
};
export const authSchemes = {
    basic: ts => ({ logout: () => { ts.basicAuthCreds = undefined; } }),
    bearer: ts => ({ logout: () => { ts.authToken = undefined; } }),
};
//# sourceMappingURL=authSchemes.js.map