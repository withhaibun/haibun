import { IRequest, IResponse } from '@haibun/web-server-express/defs.js';
import TestServer from './test-server.js';

export type TSchemeType = 'basic' | 'bearer';
type TSchemeMethods = (testServer: TestServer) => {
  check: (req: IRequest, res: IResponse) => boolean;
  logout: () => void
};

export type TAuthScheme = {
  [K in TSchemeType]: TSchemeMethods
};

const isBrowser = (req: IRequest) => {
  const userAgent = req.headers['user-agent'];
  if (!userAgent) {
    return false;
  }
  return /Mozilla|Chrome|Safari|Edge|Opera/.test(userAgent);
};

export const authSchemes: TAuthScheme = {
  basic: (testServer: TestServer) => ({
    check: (req: IRequest, res: IResponse) => {
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
  bearer: (testServer: TestServer) => ({
    check: (req: IRequest, res: IResponse) => {
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
