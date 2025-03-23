import { Response as PlaywrightResponse } from 'playwright';

import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { TNamed, OK } from '@haibun/core/build/lib/defs.js';

const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const AUTHORIZATION = 'Authorization';
export const ACCESS_TOKEN = 'access_token';

const HTTP = 'HTTP';

export const base64Encode = ({ username, password }: { username: string; password: string }) =>
	Buffer.from(`${username}:${password}`).toString('base64');

export const restSteps = (webPlaywright: WebPlaywright) => ({
	addBasicAuthCredentials: {
		gwta: `use Authorization Basic header with {username}, {password}`,
		action: async ({ username, password }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Basic ${base64Encode({ username, password })}` });
			return OK;
		},
	},
	addAuthBearerToken: {
		gwta: `use Authorization Bearer header with {token}`,
		action: async ({ token }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return OK;
		},
	},
	restTokenRequest: {
		gwta: `request OAuth 2.0 access token from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			const serialized = await webPlaywright.withPageFetch(endpoint);

			const accessToken = serialized.json[ACCESS_TOKEN];

			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${accessToken}` });

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return OK;
		},
	},
	restTokenLogout: {
		gwta: `perform OAuth 2.0 logout from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({});

			const serialized = await webPlaywright.withPageFetch(endpoint);
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return OK;
		},
	},

	acceptEndpointRequest: {
		gwta: `accept {accept} using ${HTTP} {method} to {endpoint}`,
		action: async ({ accept, method, endpoint }: TNamed) => {
			method = method.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const headers = {
				accept
			}
			const serialized = await webPlaywright.withPageFetch(endpoint, method, { headers: { accept } });
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return OK;
		},
	},
	restEndpointRequest: {
		gwta: `make an ${HTTP} {method} to {endpoint}`,
		action: async ({ method, endpoint }: TNamed) => {
			method = method.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const serialized = await webPlaywright.withPageFetch(endpoint, method);
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return OK;
		},
	},
	filterResponseJson: {
		gwta: `filter JSON response by {property} matching {match}`,
		action: async ({ property, match }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || !Array.isArray(lastResponse.json)) {
				return actionNotOK(`No JSON or array from ${JSON.stringify(lastResponse)}`);
			}

			const filtered = lastResponse.json.filter((item: any) => item[property].match(match));
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, {
				...lastResponse,
				filtered,
			});
			return OK;
		},
	},
	filteredResponseLengthIs: {
		gwta: `filtered response length is {length}`,
		action: async ({ length }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.filtered || lastResponse.filtered.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.filtered?.length}`);
			}
			return OK;
		},
	},
	responseJsonLengthIs: {
		gwta: `JSON response length is {length}`,
		action: async ({ length }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || lastResponse.json.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.json?.length}`);
			}
			return OK;
		},
	},
	restEndpointFilteredPropertyRequest: {
		gwta: `for each filtered {property}, make REST {method} to {endpoint} yielding status {status}`,
		action: async ({ property, method, endpoint, status }: TNamed) => {
			method = method.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			const { filtered } = lastResponse;
			if (!filtered) {
				return actionNotOK(`No filtered response in ${lastResponse}`);
			}
			if (!filtered.every((item: any) => item[property] !== undefined)) {
				return actionNotOK(`Property ${property} not found in all items`);
			}

			const responses = [];
			for (const item of filtered) {
				const requestPath = endpoint + '/' + item[property];
				const serialized = await webPlaywright.withPageFetch(requestPath, method);
				if (serialized.status !== parseInt(status, 10)) {
					return actionNotOK(`Expected status ${status} to ${requestPath}, got ${serialized.status}`);
				}
				responses.push(serialized);
			}

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, responses);

			return OK;
		},
	},
	restEndpointRequestWithPayload: {
		gwta: `make an ${'HTTP'} {method} to {endpoint} with {payload}`,
		action: async ({ method, endpoint, payload }: TNamed) => {
			method = method.toLowerCase();
			if (!PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} (${method}) does not support payload`);
			}
			let postData: string | object;
			if (typeof payload === 'object') {
				postData = JSON.stringify(payload);
			} else {
				postData = payload;
			}
			const requestOptions = {
				postData,
				headers: {
					'Content-Type': 'application/json',
				},
			};

			const serialized = await webPlaywright.withPageFetch(endpoint, method, requestOptions);

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return OK;
		},
	},
	restLastStatusIs: {
		gwta: `${HTTP} status is {status}`,
		action: async ({ status }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.status === parseInt(status)) {
				return OK;
			}
			return actionNotOK(`Expected status ${status}, got ${response?.status || 'no response'}`);
		},
	},
	restResponsePropertyIs: {
		gwta: `${HTTP} response property {property} is {value}`,
		action: async ({ property, value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.json && response.json[property] === value) {
				return OK;
			}
			return actionNotOK(`Expected response.json.${property} to be ${value}, got ${JSON.stringify(response?.json[property])}`);
		},
	},
	restResponseIs: {
		gwta: `${HTTP} text response is {value}`,
		action: async ({ value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.text === value) {
				return OK;
			}
			return actionNotOK(`Expected response to be ${value}, got ${response?.text}`);
		},
	},
});

export type TCapturedResponse = {
	status: number;
	statusText: string;
	headers: any;
	url: string;
	json: any;
	text: string;
};

async function capturedPlaywrightResponse(response: PlaywrightResponse): Promise<TCapturedResponse> {
	return {
		status: await response.status(),
		statusText: await response.statusText(),
		headers: response.headers(),
		url: response.url(),
		...(await payload(response)),
	};
}

async function capturedResponse(response: Partial<Response> & { headers: any }): Promise<TCapturedResponse> {
	return {
		status: await response.status,
		statusText: await response.statusText,
		headers: response.headers,
		url: response.url,
		...(await payload(response)),
	};
}

async function payload(response: { json?: () => Promise<any>; text?: () => Promise<string> }) {
	let payload;
	try {
		payload = {
			json: await response.json(),
		};
	} catch (e) {
		try {
			payload = {
				text: await response.text(),
			};
		} catch (e) {
			console.error('Failed to get payload', e);
		}
	}
	return payload;
}
