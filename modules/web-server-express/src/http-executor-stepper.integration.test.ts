import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
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

	it('fails to enable remote executor without access token', async () => {
		const testPort = TEST_PORTS.HTTP_EXECUTOR_BASE.toString();
		const feature = {
			path: '/features/http-executor.feature',
			content: `
				enable remote executor
				set testVar to "remote execution works"
				display testVar
			`
		};

		const options = {
			...baseOptions,
			moduleOptions: {
				...baseOptions.moduleOptions,
				[getStepperOptionName(new HttpExecutorStepper(), 'LISTEN_PORT')]: testPort,
			},
		};

		await expect(testWithDefaults(
			[feature],
			[WebServerStepper, HttpExecutorStepper, VariablesStepper],
			options
		)).rejects.toThrow('ACCESS_TOKEN is required when enabling remote executor');
	});

	it('enables remote executor with authentication', async () => {
		const testPort = TEST_PORTS.HTTP_EXECUTOR_AUTH.toString();
		const feature = {
			path: '/features/http-executor-auth.feature',
			content: `
				enable remote executor
				set authTestVar to "authenticated execution"
				display authTestVar
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

		const result = await testWithDefaults(
			[feature],
			[WebServerStepper, HttpExecutorStepper, VariablesStepper],
			options
		);

		expect(result.ok).toBe(true);
	});

	it('does not enable remote executor without port', async () => {
		const feature = {
			path: '/features/no-remote.feature',
			content: `
				set normalVar to "normal execution"
				display normalVar
			`
		};

		// No LISTEN_PORT configured
		const result = await testWithDefaults([feature], [WebServerStepper, HttpExecutorStepper, VariablesStepper], baseOptions);

		expect(result.ok).toBe(true);
	});
});
