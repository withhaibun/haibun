
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, testWithDefaults } from '@haibun/core/build/lib/test/lib';
import TestSteps from '@haibun/core/build/lib/test/TestSteps';
import TestStepsWithOptions from '@haibun/core/build/lib/test/TestStepsWithOptions';
import { getDefaultOptions, processEnv } from '@haibun/core/build/lib/util';
import { usageThenExit } from './lib';

describe('usageThenExit', () => {
  it('exits with success', () => {
    const ranOnce = (code: number | undefined) => { expect(code).toBe(0); return <never>undefined }
    jest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
    jest.spyOn(console, 'info').mockImplementationOnce(any => undefined);
    usageThenExit({ ...getDefaultOptions(), steppers: ['../core/src/lib/test/TestStepsWithOptions'] });
  })
  it('exits with error', () => {
    const ranOnce = (code: number | undefined) => { expect(code).toBe(1); return <never>undefined }
    jest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    usageThenExit({ ...getDefaultOptions(), steppers: ['../core/src/lib/test/TestStepsWithOptions'] }, 'woops');
  })
});

describe('options', () => {
  it('stepper options', async () => {
    const feature = { path: '/features/test.feature', content: `When I have a stepper option` };
    const { protoOptions: protoConfig } = processEnv({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, {});
    const { result } = await testWithDefaults([feature], [TestStepsWithOptions], protoConfig);
    expect(result.ok).toBe(true);
    expect(result.results?.length).toBe(1);
    expect(result.results![0].stepResults[0].actionResults[0].topics?.options.summary).toEqual('options');
  });
});

describe('builds', () => {
  it('builds with finalizer', async () => {
    const feature = { path: '/features/test.feature', content: `builds with finalizer` };
    const { result, world } = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(true);

    expect(world.shared.get('done')).toEqual('ok');
  });
});