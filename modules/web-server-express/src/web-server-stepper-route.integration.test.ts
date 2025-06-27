import { describe, it, expect } from 'vitest';

import WebHttp from '@haibun/web-http/build/web-http.js';
import { actionOK, getFromRuntime, getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { IWebServer, IRequest, IResponse, WEBSERVER } from './defs.js';

import Server from './web-server-stepper.js';
import { TNamed } from '@haibun/core/build/lib/defs.js';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import WebServerStepper from './web-server-stepper.js';
import { AStepper } from '@haibun/core/build/lib/astepper.js';
import { TEST_PORTS } from './test-constants.js';

describe('route mount', () => {
	it.skip('mounts a route', async () => {
		const TestRoute = class TestRoute extends AStepper {
			steps = {
				addRoute: {
					gwta: 'serve test route to {loc}',
					action: async ({ loc }: TNamed) => {
						const route = (req: IRequest, res: IResponse) => res.status(200).send('ok');
						const webserver: IWebServer = await getFromRuntime(this.getWorld().runtime, WEBSERVER);
						await webserver.addRoute('get', loc, route);
						return actionOK();
					},
				},
			};
		};
		const wss = new WebServerStepper();
		const feature = { path: '/features/test.feature', content: `serve test route to /test\nwebserver is listening\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_ROUTE}/test is "ok"` };
		const result = await testWithDefaults([feature], [Server, TestRoute, WebHttp], {
			options: { DEST: DEFAULT_DEST, },
			moduleOptions: {
				[getStepperOptionName(wss, 'PORT')]: TEST_PORTS.WEB_SERVER_ROUTE.toString(),
			},
		});
		expect(result.ok).toBe(true);
	});
});
