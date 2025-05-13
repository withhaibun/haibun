import { describe, it, expect } from 'vitest';

import { parseVCaptureArgs } from './vcapture-lib.js';

describe('parseArgs', () => {
	it('does not parse pass-env using next arg', () => {
		const args = ['--pass-env', 'M1=1,M2=2'];
		const { runOptions } = parseVCaptureArgs(args, () => { });
		expect(runOptions.passEnv).toBe('');
	});
	it('should parse pass-env using =', () => {
		const args = ['--pass-env=M1=1,M2=2'];
		const { runOptions } = parseVCaptureArgs(args, () => { });
		expect(runOptions.passEnv).toBe('M1=1,M2=2');
	});

	it('should parse res using =', () => {
		const args = ['--res=1280x720'];
		const { runOptions } = parseVCaptureArgs(args, () => { });
		expect(runOptions.res).toBe('1280x720');
	});
	it('should get test to run and includeDirs', () => {
		const args = ['testToRun', 'dir1', 'dir2'];
		const { testToRun, includeDirs } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1', 'dir2']);
	});
	it('handles flags and args', () => {
		const args = ['--recreate', '--no-capture', 'testToRun', 'dir1', 'dir2'];
		const { testToRun, includeDirs, runOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1', 'dir2']);
		expect(runOptions.recreate).toBe(true);
		expect(runOptions.capture).toBe(false);
		expect(runOptions.tts).toBe(false);
		expect(runOptions.passEnv).toBe(undefined);
	});
	it('handles flags at the end', () => {
		const args = ['testToRun', 'dir1', '--recreate', '--pass-env=HAIBUN_STAY=failure'];
		const { testToRun, includeDirs, runOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1']);
		expect(runOptions.recreate).toBe(true);
		expect(runOptions.tts).toBe(false);
		expect(runOptions.passEnv).toBe('HAIBUN_STAY=failure');
	});
	it('handles mixed flags', () => {
		const args = ['--tts', 'testToRun', 'dir1', '--recreate', '--pass-env=HAIBUN_STAY=failure'];
		const { testToRun, includeDirs, runOptions } = parseVCaptureArgs(args, () => { });
		expect(testToRun).toBe('testToRun');
		expect(includeDirs).toEqual(['dir1']);
		expect(runOptions.recreate).toBe(true);
		expect(runOptions.tts).toBe(true);
		expect(runOptions.passEnv).toBe('HAIBUN_STAY=failure');
	});
});
