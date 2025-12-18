import { describe, it, expect } from 'vitest';

import WebHttp from '@haibun/web-http/web-http.js';
import { actionOK, getFromRuntime, getStepperOptionName } from '@haibun/core/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/schema/protocol.js';
import { IWebServer, IRequest, IResponse, WEBSERVER } from './defs.js';

import Server from './web-server-stepper.js';
import { TStepArgs } from '@haibun/core/schema/protocol.js';
import { passWithDefaults } from '@haibun/core/lib/test/lib.js';
import WebServerStepper from './web-server-stepper.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { TEST_PORTS } from './test-constants.js';

describe('route mount', () => {
	it.skip('mounts a route', async () => {
		const TestRoute = class TestRoute extends AStepper {
			steps = {
				addRoute: {
					gwta: 'serve test route to {loc}',
					action: async ({ loc }: TStepArgs) => {
						const route = (req: IRequest, res: IResponse) => res.status(200).send('ok');
						const webserver: IWebServer = await getFromRuntime(this.getWorld().runtime, WEBSERVER);
						await webserver.addRoute('get', loc as string, route);
						return actionOK();
					},
				},
			};
		};
		const wss = new WebServerStepper();
		const feature = { path: '/features/test.feature', content: `serve test route to /test\nwebserver is listening\nfetch from http://localhost:${TEST_PORTS.WEB_SERVER_ROUTE}/test is "ok"` };
		const result = await passWithDefaults([feature], [Server, TestRoute, WebHttp], {
			options: { DEST: DEFAULT_DEST, },
			moduleOptions: {
				[getStepperOptionName(wss, 'PORT')]: TEST_PORTS.WEB_SERVER_ROUTE.toString(),
			},
		});
		expect(result.ok).toBe(true);
	});
});
