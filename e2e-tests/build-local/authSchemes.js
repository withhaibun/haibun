const isBrowser = (req) => {
    const userAgent = req.headers['user-agent'];
    if (!userAgent) {
        return false;
    }
    return /Mozilla|Chrome|Safari|Edge|Opera/.test(userAgent);
};
export const authSchemes = {
    basic: (testServer) => ({
        check: (req, res) => {
            if (isBrowser(req)) {
                res.status(401).end('Unauthorized: Browser access not allowed');
                return false;
            }
            const { authorization } = req.headers;
            const encodedCredentials = authorization?.replace('Basic ', '');
            if (testServer.basicAuthCreds === undefined || encodedCredentials === undefined) {
                res.status(401).end('Unauthorized');
                return false;
            }
            const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
            const [username, password] = decodedCredentials.split(':');
            if (username !== testServer.basicAuthCreds.username ||
                password !== testServer.basicAuthCreds.password) {
                res.status(401).end('Unauthorized');
                return false;
            }
            return true;
        },
        logout: () => (testServer.basicAuthCreds = undefined),
    }),
    bearer: (testServer) => ({
        check: (req, res) => {
            if (isBrowser(req)) {
                res.status(401).end('Unauthorized: Browser access not allowed');
                return false;
            }
            const { authorization } = req.headers;
            const token = authorization?.replace('Bearer ', '');
            if (testServer.authToken === undefined || token !== testServer.authToken) {
                res.status(401).end('Unauthorized');
                return false;
            }
            return true;
        },
        logout: () => (testServer.authToken = undefined),
    }),
};
//# sourceMappingURL=authSchemes.js.map