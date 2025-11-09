import { IRequest, IResponse } from '@haibun/web-server-express/defs.js';

import TestServer from './test-server.js';

const newToken = 'newToken';

export const restRoutes = (testServer: TestServer) => {
	return {
		async createAuthToken(req: IRequest, res: IResponse) {
			testServer.authToken = newToken;

			res.json({
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

		async checkAuth(req: IRequest, res: IResponse) {
			if (!testServer.authScheme.check(req, res)) return;
			res.status(200).json({ type: 'profile' });
		},

		async logOut(req: IRequest, res: IResponse) {
			testServer.authScheme.logout();
			const redirectTo = req.query?.post_logout_redirect_uri;
			if (redirectTo) {
				res.redirect(redirectTo!?.toString());
			}
		},

		async resourceGet(req: IRequest, res: IResponse) {
			if (!testServer.authScheme.check(req, res)) return;
			const id = parseInt(req.params.id ?? '', 10);
			const resource = testServer.resources.find((r) => r.id === id);
			if (resource) {
				res.json(resource);
			} else {
				res.status(404).end('Not Found');
			}
		},
		async resourceDelete(req: IRequest, res: IResponse) {
			if (!testServer.authScheme.check(req, res)) return;
			const id = parseInt(req.params.id ?? '', 10);
			const resource = testServer.resources.find((r) => r.id === id);
			if (resource) {
				testServer.resources = testServer.resources.filter((r) => r.id !== id);
				res.status(204).end();
			} else {
				res.status(404).end('Not Found');
			}
		},
		async resources(req: IRequest, res: IResponse) {
			if (!testServer.authScheme.check(req, res)) return;
			if (req.headers['accept'] !== 'application/json') {
				res.status(401).end(`Must use application/json, not ${req.headers['accept']}`);
				return;
			}

			res.json(testServer.resources);
		},
		async logIn(req: IRequest, res: IResponse) {
			const { username, password } = req.body;
			if ( testServer.basicAuthCreds && username === testServer.basicAuthCreds.username && password === testServer.basicAuthCreds.password) {
				testServer.authToken = newToken;
				res.cookie('token', newToken, { httpOnly: true });
				res.status(200).send('<h2>Login successful</h2>');
			} else {
				res.status(401).send('<h2>Invalid credentials</h2>');
			}
		},
	};
};
