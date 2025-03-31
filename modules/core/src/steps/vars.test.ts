import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '../lib/test/lib.js';
import Vars from './vars.js';
import { DEFAULT_DEST } from '../lib/defs.js';
const steppers = [Vars];

describe('vars', () => {
	it('assigns', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "1"' };
		const display = { path: '/features/display.feature', content: 'display "x"' };
		const verify = { path: '/features/verify.feature', content: 'variable "x" is "1"' };
		const res = await testWithDefaults([feature, display, verify], steppers);
		expect(res.ok).toBe(true);
	});
	it('assigns empty', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to "y"' };
		const verify = { path: '/features/verify.feature', content: 'variable "x" is "y"' };
		const res = await testWithDefaults([feature, verify], steppers);
		expect(res.ok).toBe(true);
	});
	it('empty does not overwrite', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to y' };
		const notempty = { path: '/features/test.feature', content: 'set empty "x" to z' };
		const verify = { path: '/features/verify.feature', content: 'variable "x" is "y"' };
		const res = await testWithDefaults([feature, notempty, verify], steppers);
		expect(res.ok).toBe(true);
	});
	it('is set', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y' };
		const verify = { path: '/features/verify.feature', content: 'variable "x" is set' };
		const res = await testWithDefaults([feature, verify], steppers);
		expect(res.ok).toBe(true);
	});
});


describe('vars between features', () => {
	it('clears variables between features', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y' };
		const verify = { path: '/features/verify.feature', content: 'variable "x" is not set' };
		const res = await testWithDefaults([feature, verify], steppers);
		expect(res.ok).toBe(true);
	});
	it.only('keeps ENVC vars between features', async () => {
		const feature = { path: '/features/test.feature', content: 'variable "b" is "1"' };
		const verify = { path: '/features/verify.feature', content: 'variable "b" is "1"' };
		const env = { b: '1' };
		const res = await testWithDefaults([feature, verify], steppers, { options: { env: env, DEST: DEFAULT_DEST }, moduleOptions: {} })
		console.log('🤑', JSON.stringify(res, null, 2));
		expect(res.ok).toBe(true);
	});

});
