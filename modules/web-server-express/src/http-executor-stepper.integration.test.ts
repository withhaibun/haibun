import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';

import WebServerStepper from './web-server-stepper.js';
import RemoteExecutorStepper from './http-executor-stepper.js';
import VariablesStepper from '@haibun/core/build/steps/variables-stepper.js';

describe('RemoteExecutorStepper integration', () => {
	const remotePort = '8125';
	const accessToken = 'test-secret-token-123';

	const baseOptions = {
		options: { DEST: DEFAULT_DEST },
		moduleOptions: {},
	};

	it('enables remote executor without authentication', async () => {
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
				[getStepperOptionName(new RemoteExecutorStepper(), 'LISTEN_PORT')]: remotePort,
			},
		};

		const result = await testWithDefaults(
			[feature],
			[WebServerStepper, RemoteExecutorStepper, VariablesStepper],
			options
		);

		expect(result.ok).toBe(true);
	});

	it('enables remote executor with authentication', async () => {
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
				[getStepperOptionName(new RemoteExecutorStepper(), 'LISTEN_PORT')]: remotePort,
				[getStepperOptionName(new RemoteExecutorStepper(), 'ACCESS_TOKEN')]: accessToken,
			},
		};

		const result = await testWithDefaults(
			[feature],
			[WebServerStepper, RemoteExecutorStepper, VariablesStepper],
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
		const result = await testWithDefaults(
			[feature],
			[WebServerStepper, RemoteExecutorStepper, VariablesStepper],
			baseOptions
		);

		expect(result.ok).toBe(true);
	});
});
