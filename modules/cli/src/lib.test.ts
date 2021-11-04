
import { run } from '@haibun/core/build/lib/run';
import { getDefaultWorld, HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, TestSteps, TestStepsWithOptions, testWithDefaults } from '@haibun/core/build/lib/TestSteps';
import { getOptionsOrDefault, processEnv } from '@haibun/core/build/lib/util';

describe('options', () => {
  it('stepper options', async () => {
    const base = process.cwd() + '/test/projects/haibun/stepper-options';
    const { world } = getDefaultWorld(0);
    const specl = getOptionsOrDefault(base);
    const { protoOptions: protoConfig } = processEnv({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, {});
    const { result } = await run({ specl, base, addSteppers: [TestStepsWithOptions], world, protoOptions: protoConfig });

    expect(result.ok).toBe(true);
    expect(result.results?.length).toBe(1);
    expect(result.results![0].stepResults[0].actionResults[0].topics?.options.summary).toEqual('options');
  });
});

describe('builds', () => {
  it('builds with finalizer', async () => {
    const feature = { path: '/features/test.feature', content: `builds with finalizer`};
    const { result, world } = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(true);

    expect(world.shared.get('done')).toEqual('ok');
  });
});