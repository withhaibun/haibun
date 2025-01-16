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
		await lib.usageThenExit({ ...getDefaultOptions(), steppers: [] });
	});
});

describe('options', () => {
	it.only('stepper options', async () => {
		const feature = { path: '/features/test.feature', content: `When I have a stepper option` };
		const protoConfig = {
			moduleOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' },
			options: { DEST: DEFAULT_DEST },
		};
		const result = await testWithDefaults([feature], [TestStepsWithOptions], protoConfig);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
		console.log('wtw', result.featureResults![0].stepResults[0].actionResult)
		expect(result.featureResults![0].stepResults[0].actionResult.topics?.options.summary).toEqual('options');
	});
});

describe('processEnv', () => {
	it('assigns boolean true', () => {
		const specl = getDefaultOptions();
		const { protoOptions } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_TRACE: 'true' }, specl.options);
		expect(protoOptions.options['TRACE']).toBeDefined();
		expect(protoOptions.options['TRACE']).toBe(true);
	});
	it('errors for non-boolean value ', () => {
		const specl = getDefaultOptions();
		const { errors } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_TRACE: 'wtw' }, specl.options);
		expect(errors.length).toBe(1);
	});
	it('assigns int', () => {
		const specl = getDefaultOptions();
		const { options } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_STEP_DELAY: '1' }, specl.options).protoOptions;
		expect(options.STEP_DELAY).toBe(1);
	});
	it('errors for string passed as int', () => {
		const specl = getDefaultOptions();
		const { errors } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_STEP_DELAY: 'x.2' }, specl.options);
		expect(errors.length).toBe(1);
	});
	it('errors for non option', () => {
		const specl = getDefaultOptions();
		const { errors } = lib.processBaseEnvToOptionsAndErrors({ HAIBUN_WTW: 'x.2' }, specl.options);
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
