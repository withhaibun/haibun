import fetch from 'node-fetch';

import { Executor } from '@haibun/core/build/phases/Executor';
import { getDefaultWorld, getStepper } from '@haibun/core/build/lib/util';
import { getTestEnv, testRun } from '@haibun/core/build/lib/TestSteps';

import server, { IWebServerStepper, WEBSERVER_STEPPER } from './web-server-stepper';


const serverLoc = [process.cwd(), 'build', 'web-server-stepper'].join('/');

describe('static mount', () => {
  it('listens on serve files', async () => {
    const { world, vstep, steppers } = await getTestEnv([serverLoc], 'serve files from test', getDefaultWorld().world);
    const res = await Executor.doFeatureStep(vstep, world);

    expect(res.ok).toBe(true);
    const server: IWebServerStepper = getStepper(steppers, WEBSERVER_STEPPER);

    expect(server.webserver).toBeDefined();
    const content = await fetch('http://localhost:8123/testfile');
    expect(await content.text()).toEqual('content');

    await server.close();
  });
  it('restricts characters used in static mount folder name', async () => {
    const { world, vstep, steppers } = await getTestEnv([serverLoc], 'serve files from l*(*$**', getDefaultWorld().world);

    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(false);

    getStepper<IWebServerStepper>(steppers, WEBSERVER_STEPPER).close();
  });
  it("doesn't re-mount same static mount", async () => {
    const { result, steppers } = await testRun('/test/static-no-remount', [server], getDefaultWorld().world);

    expect(result.ok).toBe(true);
    getStepper<IWebServerStepper>(steppers!, WEBSERVER_STEPPER).close();
  });
  it("doesn't permit different static mount", async () => {
    const { result, steppers } = await testRun('/test/static-fails', [server], getDefaultWorld().world);

    expect(result.ok).toBe(false);
    getStepper<IWebServerStepper>(steppers!, WEBSERVER_STEPPER).close();
  });
});
