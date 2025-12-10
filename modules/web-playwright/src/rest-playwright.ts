import { actionNotOK, actionOK, getStepTerm } from '@haibun/core/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { OK } from '@haibun/core/lib/defs.js';
import { EExecutionMessageType, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';
import { TStepperSteps } from '@haibun/core/lib/astepper.js';

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
	restTokenRequest: {
		gwta: `request OAuth 2.0 access token from {endpoint}`,
		action: async ({ endpoint }: { endpoint: string }, featureStep) => {
			const serialized = await webPlaywright.withPageFetch(endpoint);
			const accessToken = serialized.json[ACCESS_TOKEN];
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
		action: async ({ accept, endpoint }: { accept: string; method: string; endpoint: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')!.toLowerCase();
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
		action: async ({ endpoint }: { method: string; endpoint: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')!.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const serialized = await webPlaywright.withPageFetch(endpoint, method);
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
			const filtered = lastResponse.json.filter((item: TAnyFixme) => item[property].match(match));
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
			webPlaywright.getWorld().logger.info(`lastResponse JSON count is ${lastResponse.json.length}`)
			const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', details: { count: lastResponse.json.length } } }
			return actionOK({ messageContext });
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
			webPlaywright.getWorld().logger.info(`lastResponse filtered count is ${lastResponse.filtered.length}`)
			const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', count: lastResponse.filtered.length } };
			return actionOK({ messageContext });
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
	restEndpointFilteredPropertyRequest: {
		gwta: `for each filtered {property}, make REST {method} to {endpoint} yielding status {status}`,
		action: async ({ property, endpoint, status }: { property: string; endpoint: string; status: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')!.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			const lastResponse = webPlaywright.getLastResponse();
			const { filtered } = lastResponse;
			if (!filtered) {
				return actionNotOK(`No filtered response in ${lastResponse}`);
			}
			if (!filtered.every((item: TAnyFixme) => item[property] !== undefined)) {
				return actionNotOK(`Property ${property} not found in all items`);
			}
			for (const item of filtered) {
				const requestPath = `${endpoint}/${item[property]}`;
				const serialized = await webPlaywright.withPageFetch(requestPath, method);
				if (serialized.status !== parseInt(status, 10)) {
					return actionNotOK(`Expected status ${status} to ${requestPath}, got ${serialized.status}`);
				}
			}
			return OK;
		},
	},
	restEndpointRequestWithPayload: {
		gwta: `make an ${'HTTP'} {method} to {endpoint} with {payload}`,
		action: async ({ endpoint, payload }: { endpoint: string; payload: string }, featureStep) => {
			const method = getStepTerm(featureStep, 'method')!.toLowerCase();
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
			if (lastResponse && lastResponse.json && lastResponse.json[property] === value) {
				return OK;
			}
			return actionNotOK(`Expected lastResponse.json.${property} to be ${value}, got ${JSON.stringify(lastResponse?.json[property])}`);
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

export type TCapturedResponse = {
	status: number;
	statusText: string;
	headers: TAnyFixme;
	url: string;
	json: TAnyFixme;
	text: string;
	filtered?: TAnyFixme
};
