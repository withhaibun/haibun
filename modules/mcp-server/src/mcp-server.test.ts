import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { FastifyInstance } from 'fastify';
import { request } from 'http';

import { createFastifyServer } from './mcp-server';
import { AStepper } from '@haibun/core/build/lib/astepper';
import { OK, TActionResult, TNamed } from '@haibun/core/build/lib/defs';

let fastifyInstance: FastifyInstance;
let testPort: number;

class TestStepper extends AStepper {
	steps = {
		aPort: {
			gwta: `a {port}`,
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			action: async ({ port }: TNamed): Promise<TActionResult> => {
				return Promise.resolve(OK);
			},
		},
		portKnob: {
			gwta: `another {port} and a {knob}`,
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			action: async ({ port, knob }: TNamed): Promise<TActionResult> => {
				return Promise.resolve(OK);
			},
		},
	};
}

class TestStepper2 extends AStepper {
	steps = {
		aPort: {
			gwta: `a {sort}`,
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			action: async ({ sort }: TNamed): Promise<TActionResult> => {
				return Promise.resolve(OK);
			},
		},
	};
}


beforeAll(async () => {
	testPort = Math.floor(Math.random() * (12000 - 10000 + 1)) + 10000;
	const steppers = [new TestStepper(), new TestStepper2()];
	fastifyInstance = await createFastifyServer(testPort, steppers);
});

afterAll(async () => {
	if (fastifyInstance) {
		await fastifyInstance.close();
	}
});

describe('MCP Server Integration Tests', () => {
	it('should list steppers with detailed params correctly', async () => {
		const options = {
			hostname: 'localhost',
			port: testPort,
			path: '/steppers',
			method: 'GET',
		};

		const data = await new Promise<string>((resolve, reject) => {
			const req = request(options, (res) => {
				let responseData = '';

				res.on('data', (chunk) => {
					responseData += chunk;
				});

				res.on('end', () => {
					if (res.statusCode === 200) {
						resolve(responseData);
					} else {
						reject(new Error(`Request failed with status code ${res.statusCode}`));
					}
				});
			});

			req.on('error', (error) => {
				reject(error);
			});

			req.end();
		});

		console.log('🤑 Raw response:', data);
		const steppers = JSON.parse(data);
		console.log('🤑 Parsed response:', JSON.stringify(steppers, null, 2));

		// Validate schema includes stepper name
		steppers.forEach((stepper) => {
			expect(stepper).toHaveProperty('stepper');
			expect(typeof stepper.stepper).toBe('string');
		});

		// Validate TestStepper steps
		const testStepperSteps = steppers.filter((stepper) =>
			stepper.stepper === 'TestStepper'
		);
		testStepperSteps.forEach((stepper) => {
			const properties = stepper.params.properties;
			if (stepper.description === 'a {port}') {
				expect(properties).toHaveProperty('port');
				expect(properties.port).toHaveProperty('type', 'string');
			} else if (stepper.description === 'another {port} and a {knob}') {
				expect(properties).toHaveProperty('port');
				expect(properties.port).toHaveProperty('type', 'string');
				expect(properties).toHaveProperty('knob');
				expect(properties.knob).toHaveProperty('type', 'string');
			}
		});

		// Validate TestStepper2 steps
		const testStepper2Steps = steppers.filter((stepper) =>
			stepper.stepper === 'TestStepper2'
		);
		testStepper2Steps.forEach((stepper) => {
			const properties = stepper.params.properties;
			expect(properties).toHaveProperty('sort');
			expect(properties.sort).toHaveProperty('type', 'string');
		});
	});
});
