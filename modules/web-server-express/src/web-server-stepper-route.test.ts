
import WebHttp from '@haibun/web-http/build/web-http';
import { actionOK, getFromRuntime, getStepperOptionName } from '@haibun/core/build/lib/util';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs';
import { IWebServer, IRequest, IResponse, WEBSERVER } from './defs';

import server from './web-server-stepper';
import { AStepper, TNamed } from '@haibun/core/build/lib/defs';
import { testWithDefaults } from '@haibun/core/src/lib/test/lib';
import WebServerStepper from './web-server-stepper';

describe('route mount', () => {
  it('mounts a route', async () => {
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
    const feature = { path: '/features/test.feature', content: `serve test route to /test\nwebserver is listening\nfetch from http://localhost:8124/test is "ok"` };
    const result = await testWithDefaults([feature], [server, TestRoute, WebHttp], {
      options: { DEST: DEFAULT_DEST, },
      extraOptions: {
        [getStepperOptionName(wss, 'PORT')]: '8124',
      },
    });
    expect(result.ok).toBe(true);
  });
});
