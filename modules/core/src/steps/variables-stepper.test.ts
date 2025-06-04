import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import { DEFAULT_DEST } from '../lib/defs.js';
import Haibun from './haibun.js';
const steppers = [VariablesStepper, Haibun];

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


describe('vars between scenarios', () => {
	it('clears variables between scenarios', async () => {
		const features = [{
			path: '/features/test.feature',
			content: `
Scenario: Scenario 1
set "a" to 1
variable "a" is "1"
Scenario: Scenario 2
variable "a" is not set
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
	it('sees env vars between features', async () => {
		const feature = { path: '/features/test.feature', content: 'variable "b" is "1"' };
		const anotherFeature = { path: '/features/verify.feature', content: 'variable "b" is "1"' };
		const envVariables = { b: '1' };
		const res = await testWithDefaults([feature, anotherFeature], steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} })
		expect(res.ok).toBe(true);
	});
});

describe('feature variables', () => {
	it('keeps pre-scenario feature variables', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Checks x\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('does not overwrite feature variables', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Sets x\nvariable "x" is "y"\nset "x" to "z"\nScenario: Checks x\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between scenarios', () => {
	it('should encapsulate variables to each scenario', async () => {
		const feature = {
			path: 'test.feature',
			content: `

set "feature variable" to "something"

Scenario: Check the variable and set it

variable "feature variable" is "something"

set "feature variable" to "something else"

Scenario: Make sure it is still the feature variable value

variable "feature variable" is "something"


` }
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe.only('complex case', () => {
	it('should handle complex variable assignments', async () => {
		const feature = {
			path: 'portal/features/app/create-complete.feature',
			content: `
Backgrounds: pages/portal, service/frontend

Scenario: Setup
  Backgrounds: flows/login

Scenario: First scenario
  Backgrounds: flows/test-name, flows/entity-names
  Backgrounds: entities/create-authority`
		};

		const backgrounds = [
			{
				path: 'portal/backgrounds/pages/portal.feature',
				content: `;; portal`
			},
			{
				path: 'portal/backgrounds/service/frontend.feature',
				content: `;; frontend`
			},
			{
				path: 'portal/backgrounds/flows/login.feature',
				content: `;; login`
			},
			{
				path: 'portal/backgrounds/flows/test-name.feature',
				content: `;; test-name`
			},
			{
				path: 'portal/backgrounds/flows/entity-names.feature',
				content: `;; entity-names`
			},
			{
				path: 'portal/backgrounds/entities/create-authority.feature',
				content: `;; create-authority`
			}
		]
		const res = await testWithDefaults([feature], steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions: {} }, backgrounds);
		console.log('🤑', JSON.stringify(res.featureResults, null, 2));
		expect(res.ok).toBe(true);
	})
})
