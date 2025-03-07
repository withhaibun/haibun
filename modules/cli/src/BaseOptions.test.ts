import { it, expect, describe } from 'vitest';

import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { BaseOptions } from './BaseOptions.js';

const defaultEnv = { DEST: DEFAULT_DEST };

describe('apply ENV', () => {
	it('creates env', () => {
		const res = BaseOptions.options.ENV.parse('a=1', defaultEnv);
		expect(res.error).not.toBeDefined();
		expect(res.env).toEqual({ ...defaultEnv, a: '1' });
	});
	it('prevents collision', () => {
		const p = { DEST: DEFAULT_DEST, a: 1 };
		const res = BaseOptions.options.ENV.parse('a=1', p);
		expect(res.error).toBeDefined();
	});
});
describe.only('apply ENVC', () => {
	it('creates pairs', () => {
		const res = BaseOptions.options.ENVC.parse('a=1,b=2', defaultEnv);
		expect(res.env).toEqual({ ...defaultEnv, a: '1', b: '2' });
	});
	it('prevents existing collision', () => {
		const res = BaseOptions.options.ENVC.parse('a=1', {...defaultEnv, a: '2'});
		expect(res.error).toBeDefined();
	});
	it('prevents duplicate collision', () => {
		const res = BaseOptions.options.ENVC.parse('a=1,a=2', defaultEnv);
		expect(res.error).toBeDefined();
	});
});
