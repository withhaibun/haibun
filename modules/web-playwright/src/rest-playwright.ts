import { Page, Response } from 'playwright';

import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { TNamed, OK } from '@haibun/core/build/lib/defs.js';

const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const AUTHORIZATION = 'Authorization';
export const ACCESS_TOKEN = 'access_token';

const HTTP = 'HTTP';

export const restSteps = (webPlaywright: WebPlaywright) => ({
	addAuthBearerToken: {
		gwta: `make Authorization Bearer token {token}`,
		action: async ({ token }: TNamed) => {
			const browserContext = await webPlaywright.getBrowserContext();
			browserContext.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
			return OK;
		},
	},
	restTokenRequest: {
		gwta: `request OAuth 2.0 access token from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			const response = await webPlaywright.withPage<Response>(async (page: Page) => await page.request.get(endpoint));
			const captured = await capturedResponse(response);
			const accessToken = captured.json[ACCESS_TOKEN];
			const browserContext = await webPlaywright.getBrowserContext();
			browserContext.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${accessToken}` });

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, captured);

			return OK;
		},
	},
	restTokenLogout: {
		gwta: `perform OAuth 2.0 logout from {endpoint}`,
		action: async ({ endpoint }: TNamed) => {
			const browserContext = await webPlaywright.getBrowserContext();
			browserContext.setExtraHTTPHeaders({});

			const response = await webPlaywright.withPage<Response>(async (page: Page) => await page.request.get(endpoint));
			const captured = await capturedResponse(response);
			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, captured);

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
			const response = await webPlaywright.withPage<Response>(async (page: Page) => await page.request[method](endpoint));

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, await capturedResponse(response));

			return OK;
		},
	},
	filterResponseJson: {
		gwta: `filter JSON response by {property} matching {match}`,
		action: async ({ property, match }: TNamed) => {
			const lastResponse = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (!lastResponse?.json || !Array.isArray(lastResponse.json)) {
				return actionNotOK(`No JSON or array from ${lastResponse}`);
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
				const requesPath = endpoint + '/' + item[property];
				const response = await webPlaywright.withPage<Response>(async (page: Page) => await page.request[method](requesPath));
				if (response.status() !== parseInt(status, 10)) {
					return actionNotOK(`Expected status ${status} to ${requesPath}, got ${response.status()}`);
				}
				responses.push(await capturedResponse(response));
			}

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, responses);

			return OK;
		},
	},
	restEndpointRequestWithPayload: {
		gwta: `make an ${HTTP} {method} to {endpoint} with {payload}`,
		action: async ({ method, endpoint, payload }: TNamed) => {
			method = method.toLowerCase();
			if (!PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} does not support payload`);
			}
			try {
				const data = typeof payload === 'object' ? payload : JSON.parse(payload);
				const requestOptions = { data };

				const response = await webPlaywright.withPage<Response>(
					async (page: Page) => await page.request[method](endpoint, requestOptions)
				);

				webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, await capturedResponse(response));

				return OK;
			} catch (error: any) {
				return actionNotOK(`REST request failed: ${error.message}`);
			}
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

async function capturedResponse(response: Response) {
	const capturedResponse = {
		status: await response.status(),
		statusText: await response.statusText(),
		headers: response.headers,
		url: response.url,
		json: null,
		text: null,
	};

	try {
		capturedResponse.json = await response.json();
	} catch (error) {
		capturedResponse.text = await response.text();
	}
	return capturedResponse;
}
