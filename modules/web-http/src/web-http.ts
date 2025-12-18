import { AStepper, TStepperSteps } from '@haibun/core/lib/astepper.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';

const WebHttp = class WebHttp extends AStepper {
	steps = {
		listening: {
			gwta: 'http {url} is listening',
			action: async ({ url }: { url: string }) => {
				try {
					await fetch(url);
					return OK;
				} catch (e) {
					return actionNotOK(`${url} is not listening`, { topics: { error: e } });
				}
			},
		},
		oidc_config: {
			gwta: 'http {url} webpage has an oidc endpoint',
			action: async ({ url }: { url: string }) => {
				const response = await fetch(`${url}/.well-known/openid-configuration`);
				const json = await response.json();
				return json.authorization_endpoint ? OK : actionNotOK(`${json} has no endpoint`, { topics: { json } });
			},
		},
		statusIs: {
			gwta: 'http {method} from {url} webpage returns status {status}',
			action: async ({ url, method, status }: { url: string; method: string; status: string }) => {
				const response = await fetch(url, { method: method.toUpperCase() });
				return response.status === parseInt(status) ? OK : actionNotOK(`$${method} {url} does not have status ${status}, it has ${response.status}`)
			},
		},
		hasContentType: {
			gwta: 'http {method} from {url} webpage returns content-type {contentType}',
			action: async ({ url, method, contentType }: { url: string; method: string; contentType: string }) => {
				const response = await fetch(url, { method: (method).toUpperCase() });
				const requestContentType = response.headers.get('content-type');
				return requestContentType === contentType ? OK : actionNotOK(`${method} ${url} does not have content type ${contentType}, it has ${requestContentType}`);
			},
		},
		requestWithBody: {
			gwta: 'http {method} to {url} webpage with {contentType} body {body} returns status {status}',
			action: async ({ method, url, contentType, body, status }: { method: string; url: string; contentType: string; body: string; status: string }) => {
				const response = await fetch(url, { method: 'POST', body: JSON.stringify(JSON.parse(body)), headers: { contentType } });
				if (response.status === parseInt(status, 10)) {
					return OK;
				}
				const message = contentType === 'json' ? await response.json() : await response.text();
				return actionNotOK(`${method} ${url} did not return ${status}, it returned ${response.status} with message ${message}`);
			},
		},
		requestWithNoBody: {
			gwta: 'http {method} to {url} webpage returns status {status}',
			action: async ({ method, url, contentType, status }: { method: string; url: string; contentType: string; status: string }) => {
				const response = await fetch(url, { method: method.toUpperCase(), headers: { contentType } });
				if (response.status === parseInt(status, 10)) {
					return OK;
				}
				const message = contentType === 'json' ? await response.json() : await response.text();
				return actionNotOK(`${method} ${url} did not return ${status}, it returned ${response.status} with message ${message}`);
			},
		},
		containsContent: {
			gwta: 'http {method} from {url} webpage contains {what}',
			action: async ({ method, url, what }: { method: string; url: string; what: string }) => {
				const response = await fetch(url, { method: method.toUpperCase() });
				const text = await response.text();
				return text.includes(what) ? OK : actionNotOK(`${method} ${url} does not contain ${what}, it contains ${text}`)
			},
		},
		returnsNoContent: {
			gwta: 'http {method} from {url} webpage returns no content',
			action: async ({ method, url }: { method: string; url: string }) => {
				const response = await fetch(url, { method: method.toUpperCase() });
				const text = await response.text();
				return text === "" ? OK : actionNotOK(`${method} ${url} does not contain no content, it contains ${text}`)
			},
		},
		returnsContent: {
			gwta: 'http {method} from {url} webpage returns content {what}',
			action: async ({ method, url, what }: { method: string; url: string; what: string }) => {
				const response = await fetch(url, { method: method.toUpperCase() });
				const text = await response.text();
				return text === what ? OK : actionNotOK(`${method} ${url} does not contain ${what}, it contains ${text}`)
			},
		},
		//    http options from resource webpage returns header "Allow" with "GET, HEAD, OPTIONS, PUT, DELETE"
		headerWith: {
			gwta: 'http {method} from {url} webpage returns header {header} with {contents}',
			action: async ({ method, url, header, contents }: { method: string; url: string; header: string; contents: string }) => {
				const response = await fetch(url, { method: method.toUpperCase() });
				const headers = response.headers;
				console.log('headers', headers);
				return headers[header.toLowerCase()] === contents ? OK : actionNotOK(`${method} ${url} does not contain ${header} with ${contents}, it contains ${JSON.stringify(headers)}`)
			},
		},
	} satisfies TStepperSteps;
};

export default WebHttp;
