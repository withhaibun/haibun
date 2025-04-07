import { actionNotOK, actionOK } from '@haibun/core/build/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { TNamed, OK, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';

const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const AUTHORIZATION = 'Authorization';
export const ACCESS_TOKEN = 'access_token';

const HTTP = 'HTTP';

export const base64Encode = ({ username, password }: { username: string; password: string }) =>
	Buffer.from(`${username}:${password}`).toString('base64');

export const restSteps = (webPlaywright: WebPlaywright) => ({
	setApiUserAgent: {
		gwta: `API user agent is {agent}`,
		action: async ({ agent }: TNamed) => {
			webPlaywright.apiUserAgent = agent;
			return Promise.resolve(OK);
		}
	},
	addBasicAuthCredentials: {
		gwta: `use Authorization Basic header with {username}, {password}`,
		action: async ({ username, password }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Basic ${base64Encode({ username, password })}` });
			return Promise.resolve(OK);
		},
	},
	addAuthBearerToken: {
		gwta: `use Authorization Bearer header with {token}`,
		action: async ({ token }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return Promise.resolve(OK);
		},
	},
	restTokenRequest: {
		gwta: `request OAuth 2.0 access token from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			const serialized = await webPlaywright.withPageFetch(endpoint);

			const accessToken = serialized.json[ACCESS_TOKEN];

			await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${accessToken}` });

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return Promise.resolve(OK);
		},
	},
	restTokenLogout: {
		gwta: `perform OAuth 2.0 logout from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			await webPlaywright.setExtraHTTPHeaders({});

			const serialized = await webPlaywright.withPageFetch(endpoint);
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return Promise.resolve(OK);
		},
	},

	acceptEndpointRequest: {
		gwta: `accept {accept} using ${HTTP} {method} to {endpoint}`,
		action: async ({ accept, method, endpoint }: TNamed) => {
			method = method.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const serialized = await webPlaywright.withPageFetch(endpoint, method, { headers: { accept } });
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, serialized);

			return Promise.resolve(OK);
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

			return Promise.resolve(OK);
		},
	},
	filterResponseJson: {
		gwta: `filter JSON response by {property} matching {match}`,
		action: async ({ property, match }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || !Array.isArray(lastResponse.json)) {
				return actionNotOK(`No JSON or array from ${JSON.stringify(lastResponse)}`);
			}

			const filtered = lastResponse.json.filter((item: TAnyFixme) => item[property].match(match));
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, {
				...lastResponse,
				filtered,
			});
			return Promise.resolve(OK);
		},
	},
	filteredResponseLengthIs: {
		gwta: `filtered response length is {length}`,
		action: async ({ length }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.filtered || lastResponse.filtered.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.filtered?.length}`);
			}
			return Promise.resolve(OK);
		},
	},
	showResponseLength: {
		gwta: `show JSON response count`,
		action: async () => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || typeof lastResponse.json.length !== 'number') {
				console.debug(lastResponse);
				return Promise.resolve(actionNotOK(`No last response to count`));
			}
			webPlaywright.getWorld().logger.info(`lastResponse JSON count is ${lastResponse.json.length}`)
			return Promise.resolve(actionOK({ incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', details: { count: lastResponse.json.length } } }));
		},
	},
	showFilteredLength: {
		gwta: `show filtered response count`,
		action: async () => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.filtered || typeof lastResponse.filtered.length !== 'number') {
				console.debug(lastResponse);
				return Promise.resolve(actionNotOK(`No filtered response to count`));
			}
			webPlaywright.getWorld().logger.info(`lastResponse filtered count is ${lastResponse.filtered.length}`)
			return Promise.resolve(actionOK({ incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', count: lastResponse.filtered.length } }));
		},
	},
	responseJsonLengthIs: {
		gwta: `JSON response length is {length}`,
		action: async ({ length }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || lastResponse.json.length !== parseInt(length)) {
				return actionNotOK(`Expected ${length}, got ${lastResponse?.json?.length}`);
			}
			return Promise.resolve(OK);
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
			if (!filtered.every((item: TAnyFixme) => item[property] !== undefined)) {
				return actionNotOK(`Property ${property} not found in all items`);
			}

			const responses = [];
			for (const item of filtered) {
				const requestPath = `${endpoint}/${item[property]}`;
				const serialized = await webPlaywright.withPageFetch(requestPath, method);
				if (serialized.status !== parseInt(status, 10)) {
					return actionNotOK(`Expected status ${status} to ${requestPath}, got ${serialized.status}`);
				}
				responses.push(serialized);
			}

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, responses);

			return Promise.resolve(OK);
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

			return Promise.resolve(OK);
		},
	},
	restLastStatusIs: {
		gwta: `${HTTP} status is {status}`,
		action: async ({ status }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.status === parseInt(status)) {
				return Promise.resolve(OK);
			}
			return actionNotOK(`Expected status ${status}, got ${response?.status || 'no response'}`);
		},
	},
	restResponsePropertyIs: {
		gwta: `${HTTP} response property {property} is {value}`,
		action: async ({ property, value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.json && response.json[property] === value) {
				return Promise.resolve(OK);
			}
			return actionNotOK(`Expected response.json.${property} to be ${value}, got ${JSON.stringify(response?.json[property])}`);
		},
	},
	restResponseIs: {
		gwta: `${HTTP} text response is {value}`,
		action: async ({ value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.text === value) {
				return Promise.resolve(OK);
			}
			return actionNotOK(`Expected response to be ${value}, got ${response?.text}`);
		},
	},
});

export type TCapturedResponse = {
	status: number;
	statusText: string;
	headers: TAnyFixme;
	url: string;
	json: TAnyFixme;
	text: string;
};
