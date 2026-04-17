import { setCookie } from "@haibun/web-server-hono/cookie.js";
const newToken = "newToken";
/**
 * REST route handlers for test server.
 * These don't include auth checks - auth is applied via middleware at route registration.
 */
export const restRoutes = (testServer) => {
    return {
        async createAuthToken(c) {
            testServer.authToken = newToken;
            return c.json({
                token_type: "Bearer",
                scope: "openid profile User.Read email",
                expires_in: 5251,
                ext_expires_in: 5251,
                access_token: newToken,
                refresh_token: "refreshToken",
                id_token: "idToken",
                client_info: "client_info",
            });
        },
        async checkAuth(c) {
            // Auth is checked by middleware before this runs
            return c.json({ type: "profile" });
        },
        async logOut(c) {
            testServer.authSchemeHandler?.logout();
            const redirectTo = c.req.query("post_logout_redirect_uri");
            if (redirectTo) {
                return c.redirect(redirectTo);
            }
            return c.body(null, 204);
        },
        async resourceGet(c) {
            // Auth is checked by middleware before this runs
            const id = parseInt(c.req.param("id") ?? "", 10);
            const resource = testServer.resources.find((r) => r.id === id);
            if (resource) {
                return c.json(resource);
            }
            return c.notFound();
        },
        async resourceDelete(c) {
            // Auth is checked by middleware before this runs
            const id = parseInt(c.req.param("id") ?? "", 10);
            const resource = testServer.resources.find((r) => r.id === id);
            if (resource) {
                testServer.resources = testServer.resources.filter((r) => r.id !== id);
                return c.body(null, 204);
            }
            return c.notFound();
        },
        async resources(c) {
            // Auth is checked by middleware before this runs
            if (c.req.header("accept") !== "application/json") {
                return c.text(`Must use application/json, not ${c.req.header("accept")}`, 401);
            }
            return c.json(testServer.resources);
        },
        async logIn(c) {
            const body = await c.req.parseBody();
            const { username, password } = body;
            if (testServer.basicAuthCreds &&
                username === testServer.basicAuthCreds.username &&
                password === testServer.basicAuthCreds.password) {
                testServer.authToken = newToken;
                setCookie(c, "token", newToken, { httpOnly: true });
                return c.html("<h2>Login successful</h2>");
            }
            return c.html("<h2>Invalid credentials</h2>", 401);
        },
    };
};
//# sourceMappingURL=rest.js.map