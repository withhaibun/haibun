import fetch from 'node-fetch';

import { Executor } from '@haibun/core/build/phases/Executor';
import { getDefaultWorld, getStepper } from '@haibun/core/build/lib/util';
import { getTestEnv, testRun, testWithDefaults } from '@haibun/core/build/lib/TestSteps';

import server, { IWebServerStepper, } from './web-server-stepper';
import { WEBSERVER_STEPPER } from './defs';


const serverLoc = [process.cwd(), 'build', 'web-server-stepper'].join('/');

describe('static mount', () => {
  it('serves files', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\n` }
    const { result } = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(true);
    const content = await fetch('http://localhost:8123/testfile');
    expect(await content.text()).toEqual('content');
  });

  it('restricts characters used in static mount folder name', async () => {
    const feature = { path: '/features/test.feature', content: `serve files from l*(*$\n` }
    const { result } = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(false);
  });
  it("doesn't re-mount same static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from test\n` }
    const { result } = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(true);
  });
  it("doesn't permit different static mount", async () => {
    const feature = { path: '/features/test.feature', content: `serve files from test\nserve files from fails\n` }
    const { result } = await testWithDefaults([feature], [server]);

    expect(result.ok).toBe(false);
  });
});
