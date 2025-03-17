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
		gwta: `add auth bearer token {token}`,
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
		action: async ({  endpoint }: TNamed) => {
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
			const cookies = await webPlaywright.getCookies();
			const access_token = cookies.find((cookie) => cookie.name === ACCESS_TOKEN);
			const browserContext = await webPlaywright.getBrowserContext();
			const response = await webPlaywright.withPage<Response>(async (page: Page) => await page.request[method](endpoint));

			webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, await capturedResponse(response));

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
