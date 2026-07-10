import { createHash, randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import { actionNotOK, actionOK, getStepTerm } from '@haibun/core/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { TStepperSteps } from '@haibun/core/lib/astepper.js';

const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const AUTHORIZATION = 'Authorization';
export const ACCESS_TOKEN = 'access_token';

const HTTP = 'HTTP';

const DEFAULT_API_KEY_JWT_TTL_SECONDS = 300;

export const base64Encode = ({ username, password }: { username: string; password: string }) =>
	Buffer.from(`${username}:${password}`).toString('base64');

/**
 * Mints a v2 API key JWT: kid identifies which API key's secret the server should
 * verify against, and htm/htu bind the token to a single method + URL (query and fragment dropped).
 */
export const createApiKeyJwt = async ({
	issuer,
	apiKey,
	method,
	endpoint,
	ttlSeconds = DEFAULT_API_KEY_JWT_TTL_SECONDS,
}: {
	issuer: string;
	apiKey: string;
	method: string;
	endpoint: string;
	ttlSeconds?: number;
}): Promise<string> => {
	const keyBytes = Buffer.from(apiKey, 'hex');
	const kid = createHash('sha256').update(apiKey).digest('hex');
	const { protocol, host, pathname } = new URL(endpoint);

	return new SignJWT({
		iss: issuer,
		jti: randomUUID(),
		htm: method.toUpperCase(),
		htu: `${protocol}//${host}${pathname}`,
	})
		.setProtectedHeader({ alg: 'HS256', kid })
		.setIssuedAt()
		.setExpirationTime(`${ttlSeconds}s`)
		.sign(keyBytes);
};

/**
 * Shared by restFilterPropertyRequest and restFilterPropertyRequestWithApiKeyJwt: validates the
 * filtered response, then makes one request per item. beforeEach runs (if given) right before each
 * request, so per-item auth (like a request-bound JWT) can be applied without duplicating the loop.
 */
const filteredPropertyRequests = async (
	webPlaywright: WebPlaywright,
	{ property, endpoint, method, status }: { property: string; endpoint: string; method: string; status: string },
	beforeEach?: (requestPath: string) => Promise<void>
) => {
	if (!NO_PAYLOAD_METHODS.includes(method)) {
		return actionNotOK(`Method ${method} not supported`);
	}
	const lastResponse = webPlaywright.getLastResponse();
	const { filtered } = lastResponse;
	if (!filtered) {
		return actionNotOK(`No filtered response in ${lastResponse}`);
	}
	if (!filtered.every((item: TJsonRecord) => item[property] !== undefined)) {
		return actionNotOK(`Property ${property} not found in all items`);
	}
	for (const item of filtered) {
		const requestPath = `${endpoint}/${item[property]}`;
		await beforeEach?.(requestPath);
		const serialized = await webPlaywright.withPageFetch(requestPath, method);
		if (serialized.status !== parseInt(status, 10)) {
			return actionNotOK(`Expected status ${status} to ${requestPath}, got ${serialized.status}`);
		}
	}
	return OK;
};

export const restSteps = (webPlaywright: WebPlaywright): TStepperSteps => ({
	setApiUserAgent: {
		gwta: `API user agent is {agent}`,
		action: ({ agent }: { agent: string }) => {
			webPlaywright.apiUserAgent = agent;
			return OK;
		}
	},
	addBasicAuthCredentials: {
		gwta: `use Authorization Basic header with {username}, {password}`,
		action: async ({ username, password }: { username: string; password: string }) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Basic ${base64Encode({ username, password })}` });
			return OK;
		},
	},
	addAuthBearerToken: {
		gwta: `use Authorization Bearer header with {token}`,
		action: async ({ token }: { token: string }) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return OK;
		},
	},
	addApiKeyJwtAuthorizationHeader: {
		gwta: `use Authorization API Key JWT header with {issuer}, {apiKey} for {method} to {endpoint}`,
		action: async ({ issuer, apiKey, method, endpoint }: { issuer: string; apiKey: string; method: string; endpoint: string }) => {
			const token = await createApiKeyJwt({ issuer, apiKey, method, endpoint });
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return OK;
		},
	},
	addApiKeyJwtAuthorizationHeaderWithTtl: {
		precludes: ["WebPlaywright.addApiKeyJwtAuthorizationHeader"],
		gwta: `use Authorization API Key JWT header with {issuer}, {apiKey} for {method} to {endpoint} expiring in {ttl}s`,
		action: async ({ issuer, apiKey, method, endpoint, ttl }: { issuer: string; apiKey: string; method: string; endpoint: string; ttl: string }) => {
			const ttlSeconds = Number(ttl);
			if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
				return actionNotOK(`Expected a positive integer TTL in seconds, got ${ttl}`);
			}
			const token = await createApiKeyJwt({ issuer, apiKey, method, endpoint, ttlSeconds });
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return OK;
		},
	},
	restTokenRequest: {
		gwta: `request OAuth 2.0 access token from {endpoint}`,
		action: async ({ endpoint }: { endpoint: string }, featureStep) => {
			const serialized = await webPlaywright.withPageFetch(endpoint);
			const accessToken = !Array.isArray(serialized.json) ? (serialized.json as TJsonRecord)[ACCESS_TOKEN] : undefined;
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${accessToken}` });
			webPlaywright.setLastResponse(serialized, featureStep);
			return OK;
		},
	},
	restTokenLogout: {
		gwta: `perform OAuth 2.0 logout from {endpoint}`,
		action: async ({ endpoint }: { endpoint: string }, featureStep) => {
			await webPlaywright.setExtraHTTPHeaders({});
			const serialized = await webPlaywright.withPageFetch(endpoint);
			webPlaywright.setLastResponse(serialized, featureStep);
			return OK;
		},
	},

	acceptEndpointRequest: {
		gwta: `accept {accept} using ${HTTP} {method} to {endpoint}`,
		handlesUndefined: ['method'],
		action: async ({ accept, endpoint }: { accept: string; method: string; endpoint: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')?.toLowerCase() ?? '';
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const serialized = await webPlaywright.withPageFetch(endpoint, method, { headers: { accept } });
			webPlaywright.setLastResponse(serialized, featureStep);
			return OK;
		},
	},
	restEndpointRequest: {
		gwta: `make an ${HTTP} {method} to {endpoint}`,
		handlesUndefined: ['method'],
		action: async ({ endpoint }: { method: string; endpoint: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')?.toLowerCase() ?? '';
			// Allow all methods - for payload methods (POST/PUT/PATCH), send without body
			const requestOptions = PAYLOAD_METHODS.includes(method)
				? { postData: '', headers: { 'Content-Type': 'application/json' } }
				: undefined;
			const serialized = await webPlaywright.withPageFetch(endpoint, method, requestOptions);
			webPlaywright.setLastResponse(serialized, featureStep);
			return OK;
		},
	},
	filterResponseJson: {
		gwta: `filter JSON response by {property} matching {match}`,
		action: ({ property, match }: { property: string; match: string }, featureStep) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (!lastResponse?.json || !Array.isArray(lastResponse.json)) {
				return actionNotOK(`No JSON or array from ${JSON.stringify(lastResponse)}`);
			}
			const filtered = lastResponse.json.filter((item: TJsonRecord) => (item[property] as string)?.match?.(match));
			webPlaywright.setLastResponse({ ...lastResponse, filtered }, featureStep);
			return OK;
		},
	},
	filteredResponseLengthIs: {
		gwta: `filtered response length is {length}`,
		action: ({ length }: { length: string }) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (!lastResponse?.filtered || lastResponse.filtered.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.filtered?.length}`);
			}
			return OK;
		},
	},
	showResponseLength: {
		gwta: `show JSON response count`,
		action: () => {
			const lastResponse = webPlaywright.getLastResponse();
			if (!lastResponse?.json || typeof lastResponse.json.length !== 'number') {
				console.debug(lastResponse);
				return actionNotOK(`No last response to count`);
			}
			webPlaywright.getWorld().eventLogger.info(`lastResponse JSON count is ${lastResponse.json.length}`)
			const topics = { summary: 'options', details: { count: lastResponse.json.length } };
			return actionOK({ topics });
		},
	},
	showFilteredLength: {
		gwta: `show filtered response count`,
		action: () => {
			const lastResponse = webPlaywright.getLastResponse();
			if (!lastResponse?.filtered || typeof lastResponse.filtered.length !== 'number') {
				console.debug(lastResponse);
				return actionNotOK(`No filtered response to count`);
			}
			webPlaywright.getWorld().eventLogger.info(`lastResponse filtered count is ${lastResponse.filtered.length}`)
			const topics = { summary: 'options', count: lastResponse.filtered.length };
			return actionOK({ topics });
		},
	},
	responseJsonLengthIs: {
		gwta: `JSON response length is {length}`,
		action: ({ length }: { length: string }) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (!lastResponse?.json || lastResponse.json.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.json?.length}`);
			}
			return OK;
		},
	},
	restFilterPropertyRequest: {
		gwta: `for each filtered {property}, make REST {method} to {endpoint} yielding status {status}`,
		handlesUndefined: ['method'],
		action: async ({ property, endpoint, status }: { property: string; endpoint: string; status: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')?.toLowerCase() ?? '';
			return filteredPropertyRequests(webPlaywright, { property, endpoint, method, status });
		},
	},
	restFilterPropertyRequestWithApiKeyJwt: {
		precludes: ["WebPlaywright.restFilterPropertyRequest"],
		gwta: `for each filtered {property}, make REST {method} to {endpoint} yielding status {status} using API key JWT with {issuer}, {apiKey}`,
		handlesUndefined: ['method'],
		action: async (
			{ property, endpoint, status, issuer, apiKey }: { property: string; endpoint: string; status: string; issuer: string; apiKey: string },
			featureStep
		) => {
			const method = getStepTerm(featureStep, 'method')?.toLowerCase() ?? '';
			// Each request gets its own token, bound to its own URL: a v2 API key JWT is only valid
			// for the exact method + URL it was minted for, so one token can't cover the whole loop.
			return filteredPropertyRequests(webPlaywright, { property, endpoint, method, status }, async (requestPath) => {
				const token = await createApiKeyJwt({ issuer, apiKey, method, endpoint: requestPath });
				await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			});
		},
	},
	restEndpointRequestWithPayload: {
		precludes: ["WebPlaywright.restEndpointRequest"],
		gwta: `make an ${'HTTP'} {method} to {endpoint} with {payload}`,
		handlesUndefined: ['method'],
		action: async ({ endpoint, payload }: { endpoint: string; payload: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')?.toLowerCase() ?? '';
			if (!PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} (${method}) does not support payload`);
			}
			const requestOptions = { postData: payload, headers: { 'Content-Type': 'application/json' } };
			const serialized = await webPlaywright.withPageFetch(endpoint, method, requestOptions);
			webPlaywright.setLastResponse(serialized, featureStep);
			return OK;
		},
	},
	restLastStatusIs: {
		gwta: `${HTTP} status is {status}`,
		action: ({ status }: { status: string }) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (lastResponse && lastResponse.status === parseInt(status)) {
				return OK;
			}
			return actionNotOK(`Expected status ${status}, got ${lastResponse?.status || 'no response'}`);
		},
	},
	restResponsePropertyIs: {
		gwta: `${HTTP} response property {property} is {value}`,
		action: ({ property, value }: { property: string; value: string }) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (lastResponse && lastResponse.json && !Array.isArray(lastResponse.json) && (lastResponse.json as TJsonRecord)[property] === value) {
				return OK;
			}
			return actionNotOK(`Expected lastResponse.json.${property} to be ${value}, got ${JSON.stringify(!Array.isArray(lastResponse?.json) ? (lastResponse?.json as TJsonRecord)?.[property] : undefined)}`);
		},
	},
	restResponseIs: {
		gwta: `${HTTP} text response is {value}`,
		action: ({ value }: { value: string }) => {
			const lastResponse = webPlaywright.getLastResponse();
			if (lastResponse && lastResponse.text === value) {
				return OK;
			}
			return actionNotOK(`Expected response to be ${value}, got ${lastResponse?.text}`);
		},
	},
} as const satisfies TStepperSteps);

/** Record with string keys for JSON objects */
export type TJsonRecord = Record<string, unknown>;

/** JSON response can be an array of records or a single record */
export type TJsonResponse = TJsonRecord | TJsonRecord[];

export type TCapturedResponse = {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	url: string;
	json: TJsonResponse;
	text: string;
	filtered?: TJsonRecord[];
};

