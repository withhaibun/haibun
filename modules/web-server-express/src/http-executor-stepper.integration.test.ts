import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '@haibun/core/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';

import WebServerStepper from './web-server-stepper.js';
import HttpExecutorStepper from './http-executor-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { TEST_PORTS } from './test-constants.js';

describe('HttpExecutorStepper integration', () => {
	const accessToken = 'test-secret-token-123';

	const baseOptions = {
		options: { DEST: DEFAULT_DEST },
		moduleOptions: {},
	};

	it.skip('fails to enable remote executor without access token', async () => {
		const testPort = TEST_PORTS.HTTP_EXECUTOR_BASE.toString();
		const feature = {
			path: '/features/http-executor.feature',
			content: `
				enable remote executor
				set testVar to "remote execution works"
				show var testVar
			`
		};

		const options = {
			...baseOptions,
			moduleOptions: {
				...baseOptions.moduleOptions,
				[getStepperOptionName(new HttpExecutorStepper(), 'LISTEN_PORT')]: testPort,
			},
		};

		await expect(passWithDefaults(
			[feature],
			[WebServerStepper, HttpExecutorStepper, VariablesStepper],
			options
		)).rejects.toThrow(/ACCESS_TOKEN.*required/);
	});

	it('enables remote executor with authentication', async () => {
		const testPort = TEST_PORTS.HTTP_EXECUTOR_AUTH.toString();
		const feature = {
			path: '/features/http-executor-auth.feature',
			content: `
				set authTestVar to "authenticated execution"
				show var authTestVar
			`
		};

		const options = {
			...baseOptions,
			moduleOptions: {
				...baseOptions.moduleOptions,
				[getStepperOptionName(new HttpExecutorStepper(), 'LISTEN_PORT')]: testPort,
				[getStepperOptionName(new HttpExecutorStepper(), 'ACCESS_TOKEN')]: accessToken,
			},
		};

		const result = await passWithDefaults(
			[feature],
			[WebServerStepper, HttpExecutorStepper, VariablesStepper],
			options
		);

		expect(result.ok).toBe(true);
	});

	it.skip('does not enable remote executor without port', async () => {
		const feature = {
			path: '/features/no-remote.feature',
			content: `
				set normalVar to "normal execution"
				show var normalVar
			`
		};

		// No LISTEN_PORT configured
		const result = await passWithDefaults([feature], [WebServerStepper, HttpExecutorStepper, VariablesStepper], baseOptions);

		expect(result.ok).toBe(true);
	});
});
