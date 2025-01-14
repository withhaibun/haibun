import { vitest, describe, it, expect } from 'vitest';

import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import TestSteps from '@haibun/core/build/lib/test/TestSteps.js';
import TestStepsWithOptions from '@haibun/core/build/lib/test/TestStepsWithOptions.js';
import { getDefaultOptions } from '@haibun/core/build/lib/util/index.js';
import * as lib from './lib.js';

const s = (s) => s.split(' ');

const ranOnce = (code?: number | string | null) => {
	expect(code).toBe(0);
	return <never>undefined;
};
describe('usageThenExit', () => {
	it('exits with success', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
		vitest.spyOn(console, 'info').mockImplementationOnce(() => undefined);
		await lib.usageThenExit({ ...getDefaultOptions(), steppers: [] });
	});
	it('exits with error', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(ranOnce);
		vitest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
		await lib.usageThenExit({ ...getDefaultOptions(), steppers: [] }, 'woops');
	});
});

describe('options', () => {
	it('stepper options', async () => {
		const feature = { path: '/features/test.feature', content: `When I have a stepper option` };
		const { protoOptions: protoConfig } = lib.processBaseEnvToOptionsAndErrors(
			{ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' },
			{ DEST: DEFAULT_DEST }
		);
		const result = await testWithDefaults([feature], [TestStepsWithOptions], protoConfig);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
		expect(result.featureResults![0].stepResults[0].actionResults[0].topics?.options.summary).toEqual('options');
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
	it('carries module options', () => {
		const specl = getDefaultOptions();
		const { protoOptions } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_TEST: 'true' }, specl.options);
		expect(protoOptions.moduleOptions['HAIBUN_TEST']).toBeDefined();
	});
	it('split_shared incorrect message', () => {
		const specl = getDefaultOptions();

		const { errors } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_SPLIT_SHARED: '1,2' }, specl.options);

		expect(errors.length).toBe(1);
	});
	it('processes split_shared', () => {
		const specl = getDefaultOptions();
		const res = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_SPLIT_SHARED: 'foo=1,2' }, specl.options).protoOptions.options;
		expect(res.SPLIT_SHARED).toEqual([{ foo: '1' }, { foo: '2' }]);
	});
	it('assigns int', () => {
		const specl = getDefaultOptions();
		const { options } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_LOOPS: '1' }, specl.options).protoOptions;

		expect(options.LOOPS).toBe(1);
	});
	it('errors for string passed as int', () => {
		const specl = getDefaultOptions();
		const { errors } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_LOOPS: '1.2' }, specl.options);
		expect(errors.length).toBe(1);
	});
});

describe('processArgs', () => {
	it('finds help', () => {
		const { showHelp } = lib.processArgs(s('--help'));
		expect(showHelp).toBe(true);
	});
	it('specifies config', () => {
		const { configLoc } = lib.processArgs(s('--config boo'));
		expect(configLoc).toBe('boo');
	});
	it('get config as path', () => {
		const { configLoc } = lib.processArgs(s('--config boo/config.json'));
		expect(configLoc).toBe('boo');
	});
	it('gets help and specifies config', () => {
		const { showHelp, configLoc } = lib.processArgs(s('--config boo --help'));
		expect(configLoc).toBe('boo');
		expect(showHelp).toBe(true);
	});
	it('gets parameters', () => {
		const { params } = lib.processArgs(s('foo bar'));
		expect(params).toEqual(['foo', 'bar']);
	});
	it('gets args and parameters', () => {
		const { showHelp, configLoc, params } = lib.processArgs(s('--config boo --help foo bar'));
		expect(params).toEqual(['foo', 'bar']);
		expect(configLoc).toBe('boo');
		expect(showHelp).toBe(true);
	});
});
