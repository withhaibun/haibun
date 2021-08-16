import { OK, TFinalize, TWorkspace } from '../lib/defs';
import { getDefaultWorld } from '../lib/util';
import Builder from './Builder';

const feature = (result: any) => ({
  path: 'passes.feature',
  feature: 'test',
  vsteps: [
    {
      in: 'test',
      seq: 0,
      actions: [
        {
          name: 'test',
          step: {
            exact: 'test',
            action: async () => OK,
            build: result,
          },
        },
      ],
    },
  ],
});

describe('Builder', () => {
  test('throws', () => {
    const throws = async () => {
      throw Error('fails');
    };
    const builder = new Builder(getDefaultWorld().world);
    // expect(async () => await builder.build([feature(throws)])).rejects.toThrow('fails');
  });
  test('passes', async () => {
    const throws = async () => OK;
    const builder = new Builder(getDefaultWorld().world);
    // const res = await builder.build([feature(throws)]);
    // expect(res).toBe(OK);
  });
  test('finalizes', async () => {
    const finalize: TFinalize = (workspace: TWorkspace) => (workspace.done = true);
    const finalizes = async () => ({ ...OK, finalize });
    const workspace: TWorkspace = {};
    const builder = new Builder(getDefaultWorld().world, workspace);
    // await builder.build([feature(finalizes)]);
    // expect(workspace['passes.feature'].done).toBe(true);
  });
});
