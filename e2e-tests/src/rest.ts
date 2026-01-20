import type { Context } from '@haibun/web-server-hono/defs.js';
import { setCookie } from '@haibun/web-server-hono/cookie.js';
import type TestServer from './test-server.js';

const newToken = 'newToken';

type TRouteHandler = (c: Context) => Response | Promise<Response>;

/**
 * REST route handlers for test server.
 * These don't include auth checks - auth is applied via middleware at route registration.
 */
export const restRoutes = (testServer: TestServer): Record<string, TRouteHandler> => {
	return {
		async createAuthToken(c: Context): Promise<Response> {
			testServer.authToken = newToken;

			return c.json({
				token_type: 'Bearer',
				scope: 'openid profile User.Read email',
				expires_in: 5251,
				ext_expires_in: 5251,
				access_token: newToken,
				refresh_token: 'refreshToken',
				id_token: 'idToken',
				client_info: 'client_info',
			});
		},

		async checkAuth(c: Context): Promise<Response> {
			// Auth is checked by middleware before this runs
			return c.json({ type: 'profile' });
		},

		async logOut(c: Context): Promise<Response> {
			testServer.authSchemeHandler?.logout();
			const redirectTo = c.req.query('post_logout_redirect_uri');
			if (redirectTo) {
				return c.redirect(redirectTo);
			}
			return c.body(null, 204);
		},

		async resourceGet(c: Context): Promise<Response> {
			// Auth is checked by middleware before this runs
			const id = parseInt(c.req.param('id') ?? '', 10);
			const resource = testServer.resources.find((r) => r.id === id);
			if (resource) {
				return c.json(resource);
			}
			return c.notFound();
		},

		async resourceDelete(c: Context): Promise<Response> {
			// Auth is checked by middleware before this runs
			const id = parseInt(c.req.param('id') ?? '', 10);
			const resource = testServer.resources.find((r) => r.id === id);
			if (resource) {
				testServer.resources = testServer.resources.filter((r) => r.id !== id);
				return c.body(null, 204);
			}
			return c.notFound();
		},

		async resources(c: Context): Promise<Response> {
			// Auth is checked by middleware before this runs
			if (c.req.header('accept') !== 'application/json') {
				return c.text(`Must use application/json, not ${c.req.header('accept')}`, 401);
			}

			return c.json(testServer.resources);
		},

		async logIn(c: Context): Promise<Response> {
			const body = await c.req.parseBody<{ username: string; password: string }>();
			const { username, password } = body;
			if (
				testServer.basicAuthCreds &&
				username === testServer.basicAuthCreds.username &&
				password === testServer.basicAuthCreds.password
			) {
				testServer.authToken = newToken;
				setCookie(c, 'token', newToken, { httpOnly: true });
				return c.html('<h2>Login successful</h2>');
			}
			return c.html('<h2>Invalid credentials</h2>', 401);
		},
	};
};
