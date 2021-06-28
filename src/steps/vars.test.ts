import { TShared, TVStep, TWorld } from '../lib/defs';
import { Executor } from '../lib/Executor';
import { Resolver } from '../lib/Resolver';
import { getDefaultWorld, getSteppers } from '../lib/util';
import { didNotOverwrite } from './vars';


describe('vars', () => {
  it('assigns', async () => {
    const {world} = getDefaultWorld();
    const steppers = await getSteppers({ steppers: ['vars'], world });
    const resolver = new Resolver(steppers, 'all', world);
    const test = 'Given I set x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, world.logger);
    expect(world.shared.x).toBe('y');
  });
  it('assigns empty', async () => {
    const {world} = getDefaultWorld();
    const steppers = await getSteppers({ steppers: ['vars'], world });
    const resolver = new Resolver(steppers, '', world);
    const test = 'Given I set x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, world.logger);
    expect(world.shared.x).toBe('y');
  });
  it('empty does not overwrite', async () => {
    const {world} = getDefaultWorld();
    const shared: TShared = { x: 'notY' };
    const steppers = await getSteppers({ steppers: ['vars'], world: { ...world, shared } });
    const resolver = new Resolver(steppers, 'all', world);
    const test = 'Given I set empty x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    const res = await Executor.doFeatureStep(tvstep, world.logger);
    expect(shared.x).toBe('notY');
    expect(res.actionResults[0].details).toEqual(didNotOverwrite('x', 'notY', 'y'));
  });
});
