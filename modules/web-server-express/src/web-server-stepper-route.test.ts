import fetch from 'node-fetch';

import { actionOK, getFromRuntime, findStepper } from '@haibun/core/build/lib/util';
import { IWebServer, IRequest, IResponse, WEBSERVER, WEBSERVER_STEPPER, CHECK_LISTENER } from './defs';

import server, { IWebServerStepper, } from './web-server-stepper';
import { IExtensionConstructor, IStepper, TNamed, TWorld } from '@haibun/core/build/lib/defs';
import { testWithDefaults } from '@haibun/core/src/lib/test/lib';


describe('route mount', () => {
  it('mounts a route', async () => {
    const TestRoute: IExtensionConstructor = class TestRoute implements IStepper {
      world: TWorld;
      constructor(world: TWorld) {
        this.world = world;
      }
      steps = {
        addRoute: {
          gwta: 'serve test route to {loc}',
          action: async ({ loc }: TNamed) => {
            const route = (req: IRequest, res: IResponse) => res.status(200).send('ok');
            const webserver: IWebServer = await getFromRuntime(this.world.runtime, WEBSERVER);
            await webserver.addRoute('get', loc, route);
            webserver.listen(8123);
            
            return actionOK();
          },
        },
      };
    };
    const feature = { path: '/features/test.feature', content: `serve test route to /test\n` }
    const { result, steppers } = await testWithDefaults([feature], [ server, TestRoute], {
      options: {},
      extraOptions: {
        [`HAIBUN_O_${WEBSERVER_STEPPER.toUpperCase()}_PORT`]: '8124',
      },
    });

    expect(result.ok).toBe(true);
    const content = await fetch('http://localhost:8123/test');

    expect(await content.text()).toEqual('ok');

    findStepper<IWebServerStepper>(steppers!, WEBSERVER_STEPPER).close();
  });
});
