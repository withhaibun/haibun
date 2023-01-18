import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { IWebSocketServer, TWithContext, WEB_SOCKET_SERVER } from '@haibun/context/build/Context.js';

import FeatureImporter from './feature-importer-stepper.js';
import { AStepper } from '@haibun/core/build/lib/defs.js';
import { actionOK } from '@haibun/core/build/lib/util/index.js';

describe.skip('FeatureImporter test', () => {
  it.only('passes', async () => {
    const feature = { path: '/features/test.feature', content: `add wss\nadd browser contexts to WebSocket server` };

    let assignedProcessors = {};
    const TestWSS = class TestSteps extends AStepper {
      steps = {
        test: {
          exact: 'add wss',
          action: async (input: any) => {
            const wss: IWebSocketServer = {
              addContextProcessors: (processors: { [key: string]: (message: TWithContext) => void }) => {
                assignedProcessors = processors;
              }
            }
            this.getWorld().runtime[WEB_SOCKET_SERVER] = wss;
            return actionOK();
          }
        }
      }
    }

    const result = await testWithDefaults([feature], [FeatureImporter, TestWSS]);

    expect(result.ok).toBe(true);
    expect(Object.keys(assignedProcessors)).toEqual(['#haibun/event', '#haibun/control', '#haibun/info']);
  });
});
