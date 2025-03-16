// haibun-plugin-rest.ts
import { OK, TNamed } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import WebPlaywright from './web-playwright.js';
import { Page } from 'playwright';

const LAST_REST_RESPONSE = 'lastRestResponse';
const PAYLOAD_METHODS = ['post', 'put', 'patch'];
const NO_PAYLOAD_METHODS = ['get', 'delete', 'head'];

export const restSteps = (webPlaywright: WebPlaywright) => ({
	restEndpointRequest: {
		gwta: 'send {method} to {endpoint}',
		action: async ({ method, endpoint }: TNamed) => {
			if (!NO_PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} not supported`);
			}
			try {
				const response = await webPlaywright.withPage<Response>(async (page: Page) => await page[method](endpoint));
				const responseBody = await response.json();

				webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, { status: response.status, body: responseBody });

				return OK;
			} catch (error: any) {
				return actionNotOK(`REST request failed: ${error.message}`);
			}
		},
	},
	restEndpointRequestWithPayload: {
		gwta: 'send {method} to {endpoint} with {payload?}',
		action: async ({ method, endpoint, payload }: TNamed) => {
			if (!PAYLOAD_METHODS.includes(method)) {
				return actionNotOK(`Method ${method} does not support payload`);
			}
			try {
				const data = typeof payload === 'object' ? payload : JSON.parse(payload);
				const requestOptions = { data };

				const response = await webPlaywright.withPage<Response>(async (page: Page) => await page[method](endpoint, requestOptions));
				const responseBody = await response.json();

				webPlaywright.getWorld().shared.set(LAST_REST_RESPONSE, { status: response.status, body: responseBody });

				return OK;
			} catch (error: any) {
				return actionNotOK(`REST request failed: ${error.message}`);
			}
		},
	},
	restLastStatusIs: {
		gwta: 'last status is {status}',
		action: async ({ status }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.status === parseInt(status)) {
				return OK;
			}
			return actionNotOK(`Expected status ${status}, got ${response?.status || 'no response'}`);
		},
	},
	restResponsePropertyIs: {
		gwta: 'response property {property} is {value}',
		action: async ({ property, value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.body && response.body[property]?.toString() === value) {
				return OK;
			}
			return actionNotOK(`Expected response.${property} to be ${value}, got ${response?.body[property] || 'no response'}`);
		},
	},
	restResponseIs: {
		gwta: 'response is {value}',
		action: async ({ property, value }: TNamed) => {
			const response = webPlaywright.getWorld().shared.get(LAST_REST_RESPONSE);
			if (response && response.body && response.body[property]?.toString().includes(value)) {
				return OK;
			}
			return actionNotOK(`Expected response.${property} to contain ${value}, got ${response?.body[property] || 'no response'}`);
		},
	},
});
