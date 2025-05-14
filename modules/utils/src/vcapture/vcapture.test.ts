import { describe, it, expect } from 'vitest';

import { getContainerSetup, parseVCaptureArgs, TCaptureOptions } from './vcapture-lib.js';

describe('parseArgs', () => {
	it('does not parse pass-env using next arg', () => {
		const args = ['--pass-env', 'M1=1,M2=2'];
		const { captureOptions } = parseVCaptureArgs(args, () => { });
		expect(captureOptions.passEnv).toEqual([""]);
	});
	it('should parse pass-env using =', () => {
		const args = ['--pass-env=M1=1,M2=2'];
		const { captureOptions } = parseVCaptureArgs(args, () => { });
		expect(captureOptions.passEnv).toEqual(['M1=1,M2=2']);
	});

	it('should parse res using =', () => {
		const args = ['--res=1280x720'];
		const { captureOptions } = parseVCaptureArgs(args, () => { });
		expect(captureOptions.res).toBe('1280x720');
	});
	it('should get test to run and includeDirs', () => {
		const args = ['testToRun', 'dir1', 'dir2'];
		const { testToRun, includeDirs } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1', 'dir2']);
	});
	it('handles flags and args', () => {
		const args = ['--recreate', '--no-capture', 'testToRun', 'dir1', 'dir2'];
		const { testToRun, includeDirs, captureOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1', 'dir2']);
		expect(captureOptions.recreate).toBe(true);
		expect(captureOptions.capture).toBe(false);
		expect(captureOptions.tts).toBe(false);
		expect(captureOptions.passEnv).toBe(undefined);
	});
	it('handles flags at the end', () => {
		const args = ['testToRun', 'dir1', '--recreate', '--pass-env=HAIBUN_STAY=failure'];
		const { testToRun, includeDirs, captureOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1']);
		expect(captureOptions.recreate).toBe(true);
		expect(captureOptions.tts).toBe(false);
		expect(captureOptions.passEnv).toEqual(['HAIBUN_STAY=failure']);
	});
	it('handles mixed flags', () => {
		const args = ['--tts', 'testToRun', 'dir1', '--recreate', '--pass-env=HAIBUN_STAY=failure'];
		const { testToRun, includeDirs, captureOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1']);
		expect(captureOptions.recreate).toBe(true);
		expect(captureOptions.tts).toBe(true);
		expect(captureOptions.passEnv).toEqual(['HAIBUN_STAY=failure']);
	});
	it('handles multiple passEnv', () => {
		const args = ['--pass-env=HAIBUN_STAY=failure', '--pass-env=HAIBUN_ENV=foo=bar,wut=wow', 'testToRun', 'dir1'];
		const { captureOptions } = parseVCaptureArgs(args, () => { });
		expect(captureOptions.passEnv).toEqual(['HAIBUN_STAY=failure', 'HAIBUN_ENV=foo=bar,wut=wow']);
	});
	it('handles cli-env', () => {
		const args = ['--cli-env=foo=bar,wut=wow', 'testToRun', 'dir1'];
		const { captureOptions } = parseVCaptureArgs(args, () => { });
		expect(captureOptions.cliEnv).toEqual(['foo=bar,wut=wow']);
	})
});

describe('getComposeEnvironment', () => {
	const testToRun = 'testToRun';
	const includeDirs = ['dir1', 'dir2'];
	const protoRunOptions: TCaptureOptions = {
		recreate: false,
		tts: false,
		capture: true,
		passEnv: undefined,
		cliEnv: undefined,
		res: '1280x1024',
		featureFilter: undefined
	};
	it('should handle passEnv and cliEnv', () => {
		const captureOptions: TCaptureOptions = {
			...protoRunOptions,
			...{ cliEnv: ['foo=bar,wut=wow'] },
			... { passEnv: ['HAIBUN_STAY=failure'] }
		}
		const { composeEnvironment } = getContainerSetup(captureOptions, includeDirs, testToRun);
		const command = composeEnvironment.find((e) => e.startsWith('COMMAND_TO_RECORD='));
		expect(command).toMatch(/COMMAND_TO_RECORD=HOST_PROJECT_DIR=".*?haibun" HAIBUN_LOG_LEVEL=log HAIBUN_ENV=foo=bar,wut=wow\s+HAIBUN_STAY=failure npm run testToRun/);
	});
	it('should handle multiple passEnv and cliEnv', () => {
		const captureOptions: TCaptureOptions = {
			...protoRunOptions,
			...{ cliEnv: ['foo=bar,wut=wow', 'moo=cow,miaow=cat'] },
			... { passEnv: ['HAIBUN_STAY=failure', 'A=B'] }
		}
		const { composeEnvironment } = getContainerSetup(captureOptions, includeDirs, testToRun);
		const command = composeEnvironment.find((e) => e.startsWith('COMMAND_TO_RECORD='));
		expect(command).toMatch(/COMMAND_TO_RECORD=HOST_PROJECT_DIR=".*?haibun" HAIBUN_LOG_LEVEL=log HAIBUN_ENV=foo=bar,wut=wow,moo=cow,miaow=cat\s+HAIBUN_STAY=failure A=B npm run testToRun/);
	});
	it('should handle feature-flag', () => {
		const captureOptions = { ...protoRunOptions, featureFilter: 'foo' };
		const { composeEnvironment } = getContainerSetup(captureOptions, includeDirs, testToRun);
		const command = composeEnvironment.find((e) => e.startsWith('COMMAND_TO_RECORD='));
		expect(command).toMatch(/COMMAND_TO_RECORD=HOST_PROJECT_DIR=".*?haibun" HAIBUN_LOG_LEVEL=log\s+npm run testToRun --foo/);
	});
});
