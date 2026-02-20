import { vitest, describe, it, expect } from 'vitest';

import { CONTINUE_AFTER_ERROR, DEFAULT_DEST, STEP_DELAY } from '@haibun/core/schema/protocol.js';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, passWithDefaults } from '@haibun/core/lib/test/lib.js';
import TestStepsWithOptions from '@haibun/core/lib/test/TestStepsWithOptions.js';
import { getDefaultOptions } from '@haibun/core/lib/util/index.js';

import { OPTION_RUN_POLICY, OPTION_DRY_RUN } from '@haibun/core/run-policy/run-policy-types.js';
import * as lib from './lib.js';

const s = (s: string) => s.split(' ');

const expectExitAndThrow = (expectedCode: number) => (code?: number | string | null) => {
	expect(code).toBe(expectedCode);
	throw new Error(`exit with code ${expectedCode}`);
};

describe('usageThenExit', () => {
	it('exits with success code 0', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.usageThenExit({ ...getDefaultOptions(), steppers: [] })).rejects.toThrow('exit with code 0');
	});
	it('exits with error code 1', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(1));
		await expect(lib.usageThenExit({ ...getDefaultOptions(), steppers: [] }, 'Test Error Message')).rejects.toThrow('exit with code 1');
	});
});

describe('options', () => {
	it('stepper options', async () => {
		const feature = { path: '/features/test.feature', content: `When I have a stepper option` };
		const protoConfig = {
			moduleOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' },
			options: { DEST: DEFAULT_DEST },
		};
		const result = await passWithDefaults([feature], [TestStepsWithOptions], protoConfig);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
		expect(result.featureResults?.[0].stepResults[0].stepActionResult.topics?.summary).toEqual('options');
	});
});

describe('processEnv', () => {
	it('assigns boolean true', () => {
		const protoOptions = lib.processBaseEnvToOptionsAndErrors({ [`HAIBUN_${CONTINUE_AFTER_ERROR}`]: 'true' });
		expect(protoOptions.options[CONTINUE_AFTER_ERROR]).toBeDefined();
		expect(protoOptions.options[CONTINUE_AFTER_ERROR]).toBe(true);
	});
	it('errors for non-boolean value ', () => {
		expect(() => lib.processBaseEnvToOptionsAndErrors({ HAIBUN_TRACE: 'wtw' })).toThrow();
	});
	it('assigns int', () => {
		const { options } = lib.processBaseEnvToOptionsAndErrors({ [`HAIBUN_${STEP_DELAY}`]: '1' });
		expect(options[STEP_DELAY]).toBe(1);
	});
	it('errors for string passed as int', () => {
		expect(() => lib.processBaseEnvToOptionsAndErrors({ [`HAIBUN_${STEP_DELAY}`]: 'x.2' })).toThrow();
	});
	it('errors for non option', () => {
		expect(() => lib.processBaseEnvToOptionsAndErrors({ HAIBUN_WTW: 'x.2' })).toThrow();
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
	it('get config as filename', () => {
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
	it('parses --run-policy with two args', () => {
		const { policyConfig, params } = lib.processArgs(s(`${OPTION_RUN_POLICY} prod smoke:r,api:a foo`));
		expect(policyConfig).toBeDefined();
		const config = policyConfig as NonNullable<typeof policyConfig>;
		expect(config.env).toBe('prod');
		expect(config.dirFilters).toEqual([
			{ dir: 'smoke', access: 'r' },
			{ dir: 'api', access: 'a' },
		]);
		expect(params).toEqual(['foo']);
	});
	it(`returns undefined policyConfig when ${OPTION_RUN_POLICY} not specified`, () => {
		const { policyConfig } = lib.processArgs(s('foo'));
		expect(policyConfig).toBeUndefined();
	});
	it('parses --dry-run flag', () => {
		const { dryRun, policyConfig } = lib.processArgs(s(`${OPTION_DRY_RUN} ${OPTION_RUN_POLICY} prod smoke:r foo`));
		expect(dryRun).toBe(true);
		expect(policyConfig).toBeDefined();
	});
	it('returns dryRun false by default', () => {
		const { dryRun } = lib.processArgs(s('foo'));
		expect(dryRun).toBe(false);
	});
});

describe('runCli', () => {
	it('runs with --show-steppers', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s('--config modules/cli/test --show-steppers'), {})).rejects.toThrow('exit with code 0');
	});
	it('fails with no config', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(1));
		await expect(lib.runCli(s('--config nowhere/noway'), {})).rejects.toThrow('exit with code 1');
	});
	it('runs a basic test', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(0));
		await expect(() => lib.runCli(s('--config modules/cli/test modules/cli/test/tests'), {})).rejects.toThrow('exit with code 0');
	});
	it('runs a kireji test with backgrounds and features', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s('--config modules/cli/test/kireji modules/cli/test/kireji'), {})).rejects.toThrow('exit with code 0');
	});

	it('runs a kireji test with outcomes', async () => {
		vitest.spyOn(process, 'exit').mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s('--config modules/cli/test/kireji-outcomes modules/cli/test/kireji-outcomes'), {})).rejects.toThrow('exit with code 0');
	});
});
