import { WorkspaceContext } from '../lib/contexts';
import { OK, TFinalize } from '../lib/defs';
import { getCreateSteppers, getDefaultWorld } from '../lib/test/lib';
import Builder from './Builder';

describe('Builder', async () => {
  const steppers = await getCreateSteppers([])
  test('throws', () => {
    const throws = async () => {
      throw Error('fails');
    };
    const builder = new Builder(steppers, getDefaultWorld(0).world);
    // expect(async () => await builder.build([feature(throws)])).rejects.toThrow('fails');
  });
  test('passes', async () => {
    const throws = async () => OK;
    const builder = new Builder(steppers, getDefaultWorld(0).world);
    // const res = await builder.build([feature(throws)]);
    // expect(res).toBe(OK);
  });
  test('finalizes', async () => {
    const finalize: TFinalize = (workspace: WorkspaceContext) => (workspace.set('done', true));
    const finalizes = async () => ({ ...OK, finalize });
    const workspace: WorkspaceContext = new WorkspaceContext(`test builder finalizes`);
    const builder = new Builder(steppers, getDefaultWorld(0).world, workspace);
    // await builder.build([feature(finalizes)]);
    // expect(workspace['passes.feature'].done).toBe(true);
  });
});
