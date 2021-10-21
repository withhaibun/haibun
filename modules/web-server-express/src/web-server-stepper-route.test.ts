import fetch from 'node-fetch';
import { Request, Response } from 'express';

import { actionOK, getDefaultWorld, getFromRuntime, getStepper } from '@haibun/core/build/lib/util';
import { testRun } from '@haibun/core/build/lib/TestSteps';
import { IWebServer } from '@haibun/core/build/lib/interfaces/webserver';

import server, { IWebServerStepper, WEBSERVER, WEBSERVER_STEPPER } from './web-server-stepper';
import { IExtensionConstructor, IStepper, TNamed, TWorld } from '@haibun/core/build/lib/defs';

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
            const route = (req: Request, res: Response) => res.status(200).send('ok');
            const webserver: IWebServer = getFromRuntime(this.world.runtime, WEBSERVER);
            await webserver.addRoute('get', loc, route);
            return actionOK();
          },
        },
      };
    };
    const { world } = getDefaultWorld();
    const { result, steppers } = await testRun('/test/route', [server, TestRoute], world, {
      options: {},
      extraOptions: {
        [`HAIBUN_O_${WEBSERVER_STEPPER.toUpperCase()}_PORT`]: '8124',
      },
    });

    expect(result.ok).toBe(true);
    const content = await fetch('http://localhost:8124/test');
    expect(await content.text()).toEqual('ok');

    getStepper<IWebServerStepper>(steppers!, WEBSERVER_STEPPER).close();
  });
});
