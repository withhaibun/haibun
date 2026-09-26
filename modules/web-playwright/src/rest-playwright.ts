import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import WebPlaywright from "./web-playwright.js";
import { WEB_PLAYWRIGHT_ACTIONS } from "./actions.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { TStepperSteps } from "@haibun/core/lib/astepper.js";
import { DOMAIN_NUMBER, DOMAIN_LINK, DOMAIN_TEXT, DOMAIN_JSON, DOMAIN_BEARER_TOKEN, DOMAIN_PASSWORD, DOMAIN_USER_NAME } from "@haibun/core/lib/domains.js";
import {
	DOMAIN_HTTP_METHOD,
	DOMAIN_HTTP_METHOD_WITH_BODY,
	DOMAIN_HTTP_METHOD_WITHOUT_BODY,
	DOMAIN_JSON_PROPERTY,
	DOMAIN_JSON_RESPONSE_COUNT,
	DOMAIN_MEDIA_TYPE,
	HTTP_METHODS_WITH_BODY,
} from "./domains.js";

export const AUTHORIZATION = "Authorization";
export const ACCESS_TOKEN = "access_token";

const HTTP = "HTTP";

export const base64Encode = ({ username, password }: { username: string; password: string }) => Buffer.from(`${username}:${password}`).toString("base64");

export const restSteps = (webPlaywright: WebPlaywright): TStepperSteps =>
	({
		setApiUserAgent: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `API user agent is {agent: ${DOMAIN_TEXT}}`,
			action: ({ agent }: { agent: string }) => {
				webPlaywright.apiUserAgent = agent;
				return OK;
			},
		},
		addBasicAuthCredentials: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `use Authorization Basic header with {username: ${DOMAIN_USER_NAME}}, {password: ${DOMAIN_PASSWORD}}`,
			action: async ({ username, password }: { username: string; password: string }) => {
				await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Basic ${base64Encode({ username, password })}` });
				return OK;
			},
		},
		addAuthBearerToken: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `use Authorization Bearer header with {token: ${DOMAIN_BEARER_TOKEN}}`,
			action: async ({ token }: { token: string }) => {
				await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${token}` });
				return OK;
			},
		},
		restTokenRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `request OAuth 2.0 access token from {endpoint: ${DOMAIN_LINK}}`,
			action: async ({ endpoint }: { endpoint: string }, featureStep) => {
				const serialized = await webPlaywright.withPageFetch(endpoint);
				const accessToken = !Array.isArray(serialized.json) ? (serialized.json as TJsonRecord)[ACCESS_TOKEN] : undefined;
				await webPlaywright.setExtraHTTPHeaders({ [AUTHORIZATION]: `Bearer ${accessToken}` });
				await webPlaywright.setLastResponse(serialized, featureStep);
				return OK;
			},
		},
		restTokenLogout: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `perform OAuth 2.0 logout from {endpoint: ${DOMAIN_LINK}}`,
			action: async ({ endpoint }: { endpoint: string }, featureStep) => {
				await webPlaywright.setExtraHTTPHeaders({});
				const serialized = await webPlaywright.withPageFetch(endpoint);
				await webPlaywright.setLastResponse(serialized, featureStep);
				return OK;
			},
		},

		acceptEndpointRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `accept {accept: ${DOMAIN_MEDIA_TYPE}} using ${HTTP} {method: ${DOMAIN_HTTP_METHOD_WITHOUT_BODY}} to {endpoint: ${DOMAIN_LINK}}`,
			action: async ({ accept, method, endpoint }: { accept: string; method: string; endpoint: string }, featureStep) => {
				const serialized = await webPlaywright.withPageFetch(endpoint, method.toLowerCase(), { headers: { accept } });
				await webPlaywright.setLastResponse(serialized, featureStep);
				return OK;
			},
		},
		restEndpointRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `make an ${HTTP} {method: ${DOMAIN_HTTP_METHOD}} to {endpoint: ${DOMAIN_LINK}}`,
			action: async ({ method, endpoint }: { method: string; endpoint: string }, featureStep) => {
				// A method that sends a body sends an empty one here.
				const requestOptions = (HTTP_METHODS_WITH_BODY as readonly string[]).includes(method) ? { postData: "", headers: { "Content-Type": "application/json" } } : undefined;
				const serialized = await webPlaywright.withPageFetch(endpoint, method.toLowerCase(), requestOptions);
				await webPlaywright.setLastResponse(serialized, featureStep);
				return OK;
			},
		},
		filterResponseJson: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `filter JSON response by {property: ${DOMAIN_JSON_PROPERTY}} matching {match: ${DOMAIN_TEXT}}`,
			action: async ({ property, match }: { property: string; match: string }, featureStep) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (!lastResponse?.json || !Array.isArray(lastResponse.json)) {
					return actionNotOK(`No JSON or array from ${JSON.stringify(lastResponse)}`);
				}
				const filtered = lastResponse.json.filter((item: TJsonRecord) => (item[property] as string)?.match?.(match));
				await webPlaywright.setLastResponse({ ...lastResponse, filtered }, featureStep);
				return OK;
			},
		},
		filteredResponseLengthIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `filtered response length is {length: ${DOMAIN_NUMBER}}`,
			action: async ({ length }: { length: number }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (!lastResponse?.filtered || lastResponse.filtered.length !== length) {
					return actionNotOK(`Expected ${length}, got ${lastResponse?.filtered?.length}`);
				}
				return OK;
			},
		},
		showResponseLength: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `show JSON response count`,
			productsDomain: DOMAIN_JSON_RESPONSE_COUNT,
			action: async () => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (!lastResponse?.json || typeof lastResponse.json.length !== "number") {
					console.debug(lastResponse);
					return actionNotOK(`No last response to count`);
				}
				webPlaywright.getWorld().eventLogger.info(`lastResponse JSON count is ${lastResponse.json.length}`);
				return actionOKWithProducts({
					summary: `JSON response contains ${lastResponse.json.length} items`,
					details: { count: lastResponse.json.length },
				});
			},
		},
		responseJsonLengthIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `JSON response length is {length: ${DOMAIN_NUMBER}}`,
			action: async ({ length }: { length: number }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (!lastResponse?.json || lastResponse.json.length !== length) {
					return actionNotOK(`Expected ${length}, got ${lastResponse?.json?.length}`);
				}
				return OK;
			},
		},
		restFilterPropertyRequest: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `for each filtered {property: ${DOMAIN_JSON_PROPERTY}}, make REST {method: ${DOMAIN_HTTP_METHOD_WITHOUT_BODY}} to {endpoint: ${DOMAIN_LINK}} yielding status {status: ${DOMAIN_NUMBER}}`,
			action: async ({ property, method, endpoint, status }: { property: string; method: string; endpoint: string; status: number }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				const { filtered } = lastResponse;
				if (!filtered) {
					return actionNotOK(`No filtered response in ${lastResponse}`);
				}
				if (!filtered.every((item: TJsonRecord) => item[property] !== undefined)) {
					return actionNotOK(`Property ${property} not found in all items`);
				}
				for (const item of filtered) {
					const requestPath = `${endpoint}/${item[property]}`;
					const serialized = await webPlaywright.withPageFetch(requestPath, method.toLowerCase());
					if (serialized.status !== status) {
						return actionNotOK(`Expected status ${status} to ${requestPath}, got ${serialized.status}`);
					}
				}
				return OK;
			},
		},
		restEndpointRequestWithPayload: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			precludes: ["WebPlaywright.restEndpointRequest"],
			gwta: `make an ${HTTP} {method: ${DOMAIN_HTTP_METHOD_WITH_BODY}} to {endpoint: ${DOMAIN_LINK}} with {payload: ${DOMAIN_JSON}}`,
			action: async ({ method, endpoint, payload }: { method: string; endpoint: string; payload: unknown }, featureStep) => {
				const requestOptions = { postData: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
				const serialized = await webPlaywright.withPageFetch(endpoint, method.toLowerCase(), requestOptions);
				await webPlaywright.setLastResponse(serialized, featureStep);
				return OK;
			},
		},
		restLastStatusIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} status is {status: ${DOMAIN_NUMBER}}`,
			action: async ({ status }: { status: number }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (lastResponse && lastResponse.status === status) {
					return OK;
				}
				return actionNotOK(`Expected status ${status}, got ${lastResponse?.status || "no response"}`);
			},
		},
		restResponsePropertyIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} response property {property: ${DOMAIN_JSON_PROPERTY}} is {value: ${DOMAIN_TEXT}}`,
			action: async ({ property, value }: { property: string; value: string }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (lastResponse && lastResponse.json && !Array.isArray(lastResponse.json) && (lastResponse.json as TJsonRecord)[property] === value) {
					return OK;
				}
				return actionNotOK(
					`Expected lastResponse.json.${property} to be ${value}, got ${JSON.stringify(!Array.isArray(lastResponse?.json) ? (lastResponse?.json as TJsonRecord)?.[property] : undefined)}`,
				);
			},
		},
		restResponseIs: {
			capability: WEB_PLAYWRIGHT_ACTIONS.fetch,
			gwta: `${HTTP} text response is {value: ${DOMAIN_TEXT}}`,
			action: async ({ value }: { value: string }) => {
				const lastResponse = await webPlaywright.getLastResponse();
				if (lastResponse && lastResponse.text === value) {
					return OK;
				}
				return actionNotOK(`Expected response to be ${value}, got ${lastResponse?.text}`);
			},
		},
	}) as const satisfies TStepperSteps;

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
