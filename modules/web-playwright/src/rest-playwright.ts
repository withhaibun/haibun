import { Page, Response } from 'playwright';

import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { TNamed, OK } from '@haibun/core/build/lib/defs.js';

const LAST_REST_RESPONSE = 'LAST_REST_RESPONSE';
const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const restSteps = (webPlaywright: WebPlaywright) => ({
	addAuthBearerToken: {
		gwta: 'add auth bearer token {token}',
		action: async ({ token }: TNamed) => {
			const browserContext = await webPlaywright.getBrowserContext();
			browserContext.setExtraHTTPHeaders({ Authorization: `Bearer ${token}` });
			return OK;
		},
	},
	restEndpointRequest: {
		gwta: 'make an http {method} to {endpoint}',
		action: async ({ method, endpoint }: TNamed) => {
			method = method.toLowerCase();
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			try {
				const response = await webPlaywright.withPage<Response>(
					async (page: Page) =>
						await page.request[method](endpoint, {
							// headers: {
							// 	Authorization: `Bearer testtoken`,
							// },
						})
				);

				webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, await capturedResponse(response));

				return OK;
			} catch (error: any) {
				return actionNotOK(`REST request failed: ${error.message}`);
			}
		},
	},
	restEndpointRequestWithPayload: {
		gwta: 'make an http {method} to {endpoint} with {payload}',
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
		gwta: 'http status is {status}',
		action: async ({ status }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.status === parseInt(status)) {
				return OK;
			}
			return actionNotOK(`Expected status ${status}, got ${response?.status || 'no response'}`);
		},
	},
	restResponsePropertyIs: {
		gwta: 'http response property {property} is {value}',
		action: async ({ property, value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.body && response.body[property]?.toString() === value) {
				return OK;
			}
			return actionNotOK(`Expected response.${property} to be ${value}, got ${response?.body[property]}`);
		},
	},
	restResponseIs: {
		gwta: 'http text response is {value}',
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
