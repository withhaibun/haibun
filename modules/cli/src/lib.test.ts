
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, testWithDefaults } from '@haibun/core/build/lib/test/lib';
import TestSteps from '@haibun/core/build/lib/test/TestSteps';
import TestStepsWithOptions from '@haibun/core/build/lib/test/TestStepsWithOptions';
import { getDefaultOptions } from '@haibun/core/build/lib/util/index.js';
import * as lib from './lib';
import { processBaseEnv } from './lib';

describe('usageThenExit', () => {
  it('exits with success', () => {
    const ranOnce = (code: number | undefined) => { expect(code).toBe(0); return <never>undefined }
    jest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
    jest.spyOn(console, 'info').mockImplementationOnce(any => undefined);
    lib.usageThenExit({ ...getDefaultOptions(), steppers: ['../core/src/lib/test/TestStepsWithOptions'] });
  })
  it('exits with error', () => {
    const ranOnce = (code: number | undefined) => { expect(code).toBe(1); return <never>undefined }
    jest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    lib.usageThenExit({ ...getDefaultOptions(), steppers: ['../core/src/lib/test/TestStepsWithOptions'] }, 'woops');
  })
});

describe('options', () => {
  it('stepper options', async () => {
    const feature = { path: '/features/test.feature', content: `When I have a stepper option` };
    const { protoOptions: protoConfig } = processBaseEnv({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, {DEST: DEFAULT_DEST});
    const result = await testWithDefaults([feature], [TestStepsWithOptions], protoConfig);
    expect(result.ok).toBe(true);
    expect(result.results?.length).toBe(1);
    expect(result.results![0].stepResults[0].actionResults[0].topics?.options.summary).toEqual('options');
  });
});

describe('builds', () => {
  it.skip('builds with finalizer', async () => {
    const feature = { path: '/features/test.feature', content: `builds with finalizer` };
    const result = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(true);

    expect(result.shared.get('done')).toEqual('ok');
  });
});

describe('processEnv', () => {
  it('carries extra options', () => {
    const specl = getDefaultOptions();
    const { protoOptions } = lib.processBaseEnv({ HAIBUN_TEST: 'true' }, specl.options);

    expect(protoOptions.extraOptions['HAIBUN_TEST']).toBeDefined();
  });
  it('split_shared incorrect message', () => {
    const specl = getDefaultOptions();

    const { errors } = lib.processBaseEnv({ HAIBUN_SPLIT_SHARED: '1,2' }, specl.options);

    expect(errors.length).toBe(1);
  });
  it('processes split_shared', () => {
    const specl = getDefaultOptions();
    const res = lib.processBaseEnv({ HAIBUN_SPLIT_SHARED: 'foo=1,2' }, specl.options).protoOptions.options;
    expect(res.SPLIT_SHARED).toEqual([{ foo: '1' }, { foo: '2' }]);
  });
  it('assigns int', () => {
    const specl = getDefaultOptions();
    const { options } = lib.processBaseEnv({ HAIBUN_LOOPS: '1' }, specl.options).protoOptions;

    expect(options.LOOPS).toBe(1);
  })
  it('errors for string passed as int', () => {
    const specl = getDefaultOptions();
    const { errors } = lib.processBaseEnv({ HAIBUN_LOOPS: '1.2' }, specl.options);
    expect(errors.length).toBe(1);
  });
});