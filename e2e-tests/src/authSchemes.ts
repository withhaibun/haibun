import crypto from 'crypto';
import { jwtVerify } from 'jose';
import type { Context, MiddlewareHandler } from '@haibun/web-server-hono/defs.js';
import { basicAuth, bearerAuth } from '@haibun/web-server-hono/auth.js';
import type TestServer from './test-server.js';

export type TSchemeType = 'basic' | 'bearer' | 'apiKeyJwt';

const isBrowser = (c: { req: { header: (name: string) => string | undefined } }): boolean => {
  const ua = c.req.header('user-agent');
  return !!ua && /Mozilla|Chrome|Safari|Edge|Opera/.test(ua);
};

// Matches @haibun/web-playwright's createApiKeyJwt: htu is protocol + host + path, query and fragment dropped.
const normalizeUrl = (url: string): string => {
  const { protocol, host, pathname } = new URL(url);
  return `${protocol}//${host}${pathname}`;
};

// kid identifies which API key's secret the token was signed with.
const hasValidKid = (kid: unknown, apiKey: string): boolean => kid === crypto.createHash('sha256').update(apiKey).digest('hex');

const hasValidClaims = (payload: Record<string, unknown>, expected: { issuer: string; method: string; url: string }): boolean =>
  payload.iss === expected.issuer && payload.htm === expected.method && payload.htu === normalizeUrl(expected.url);

// v2 API key JWTs are single-use: a repeated jti is a replay and must be rejected.
const consumeJti = (ts: TestServer, jti: unknown): boolean => {
  if (typeof jti !== 'string' || ts.usedApiKeyJwtIds.has(jti)) return false;
  ts.usedApiKeyJwtIds.add(jti);
  return true;
};

// Independently verifies a v2 API key JWT (see @haibun/web-playwright's createApiKeyJwt) using jose itself,
// proving the client's token round-trips against a real JWT verifier, not just the client's own signing code.
const verifyApiKeyJwt = async (token: string, c: Context, ts: TestServer): Promise<boolean> => {
  if (!ts.apiKeyJwtCreds) return false;
  const { issuer, apiKey } = ts.apiKeyJwtCreds;

  let payload: Record<string, unknown>;
  let kid: unknown;
  try {
    // jose validates the signature and exp/nbf; alg is allowlisted to prevent algorithm-confusion attacks.
    const verified = await jwtVerify(token, Buffer.from(apiKey, 'hex'), { algorithms: ['HS256'] });
    payload = verified.payload;
    kid = verified.protectedHeader.kid;
  } catch {
    return false;
  }

  return hasValidKid(kid, apiKey) && hasValidClaims(payload, { issuer, method: c.req.method, url: c.req.url }) && consumeJti(ts, payload.jti);
};

export const createAuthMiddleware = {
  basic: (ts: TestServer): MiddlewareHandler => basicAuth({
    verifyUser: (username, password, c) => {
      if (isBrowser(c) || !ts.basicAuthCreds) return false;
      return username === ts.basicAuthCreds.username && password === ts.basicAuthCreds.password;
    },
  }),
  bearer: (ts: TestServer): MiddlewareHandler => bearerAuth({
    verifyToken: (token, c) => {
      if (isBrowser(c)) return false;
      return ts.authToken !== undefined && token === ts.authToken;
    },
  }),
  apiKeyJwt: (ts: TestServer): MiddlewareHandler => bearerAuth({
    verifyToken: (token, c) => {
      if (isBrowser(c)) return false;
      return verifyApiKeyJwt(token, c, ts);
    },
  }),
};

export const createDynamicAuthMiddleware = (ts: TestServer): MiddlewareHandler => {
  const handlers: Record<TSchemeType, MiddlewareHandler> = {
    basic: createAuthMiddleware.basic(ts),
    bearer: createAuthMiddleware.bearer(ts),
    apiKeyJwt: createAuthMiddleware.apiKeyJwt(ts),
  };
  return async (c, next) => {
    if (!ts.currentAuthScheme) return c.text('Unauthorized', 401);
    return handlers[ts.currentAuthScheme](c, next);
  };
};

export interface AuthSchemeLogout { logout: () => void; }

export const authSchemes: Record<TSchemeType, (ts: TestServer) => AuthSchemeLogout> = {
  basic: ts => ({ logout: () => { ts.basicAuthCreds = undefined; } }),
  bearer: ts => ({ logout: () => { ts.authToken = undefined; } }),
  apiKeyJwt: ts => ({ logout: () => { ts.apiKeyJwtCreds = undefined; } }),
};
