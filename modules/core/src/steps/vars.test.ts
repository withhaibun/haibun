import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '../lib/test/lib.js';
import Vars from './vars.js';
import { DEFAULT_DEST } from '../lib/defs.js';
import Haibun from './haibun.js';
const steppers = [Vars, Haibun];

describe('vars', () => {
	it('assigns', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "1"\ndisplay "x"\nvariable "x" is "1"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('assigns empty', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to "y", variable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('empty does not overwrite', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to y\nset empty "x" to z\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('is set', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y\nvariable "x" is set' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});


describe.only('vars between scenarios', () => {
	it('clears variables between scenarios', async () => {
		const features = [{
			path: '/features/test.feature',
			content: `
Scenario: Scenario 1
set "a" to 1
variable "a" is "1"
Scenario: Scenario 2
show vars
variable "a" is is "1"
`}];
		const res = await testWithDefaults(features, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between features', () => {
	it('clears variables between features', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y' };
		const anotherFeature = { path: '/features/verify.feature', content: 'variable "x" is not set' };
		const res = await testWithDefaults([feature, anotherFeature], steppers);
		expect(res.ok).toBe(true);
	});
	it('keeps env vars between features', async () => {
		const feature = { path: '/features/test.feature', content: 'variable "b" is "1"' };
		const anotherFeature = { path: '/features/verify.feature', content: 'variable "b" is "1"' };
		const envVariables = { b: '1' };
		const res = await testWithDefaults([feature, anotherFeature], steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} })
		expect(res.ok).toBe(true);
	});
});
