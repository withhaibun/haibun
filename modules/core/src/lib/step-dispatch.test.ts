import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import { buildStepRegistry, validateToolInput, stepMethodName, createStepHandler, type StepTool } from './step-dispatch.js';
import { AStepper } from './astepper.js';
import { OK } from '../schema/protocol.js';
import { actionOKWithProducts, actionNotOK } from './util/index.js';
import { getDefaultWorld } from './test/lib.js';
import type { TWorld, TStepperStep } from './defs.js';

// --- Test Steppers ---

class PlainStepper extends AStepper {
	steps = {
		greet: {
			gwta: 'say hello to {name}',
			action: ({ name }: { name: string }) => {
				return OK;
			},
		},
		hidden: {
			gwta: 'do secret thing',
			expose: false,
			action: async () => OK,
		},
	};
}

class ProductStepper extends AStepper {
	steps = {
		getCount: {
			gwta: 'get the count',
			outputSchema: z.object({ count: z.number() }),
			action: () => {
				return actionOKWithProducts({ count: 42 });
			},
		},
		failStep: {
			gwta: 'fail on purpose',
			action: () => {
				return actionNotOK('intentional failure');
			},
		},
		throwStep: {
			gwta: 'throw an error',
			action: () => {
				throw new Error('boom');
			},
		},
	};
}

describe('step-dispatch', () => {
	let world: TWorld;

	beforeEach(() => {
		world = getDefaultWorld();
	});

	describe('stepMethodName', () => {
		it('creates name from strings', () => {
			expect(stepMethodName('MyStepper', 'doThing')).toBe('MyStepper-doThing');
		});

		it('creates name from AStepper instance', () => {
			const stepper = new PlainStepper();
			expect(stepMethodName(stepper, 'greet')).toBe('PlainStepper-greet');
		});

		it('creates name from object with name', () => {
			expect(stepMethodName({ name: 'Foo' }, 'bar')).toBe('Foo-bar');
		});
	});

	describe('buildStepRegistry', () => {
		it('registers exposed steps', () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.has('PlainStepper-greet')).toBe(true);
		});

		it('excludes expose:false steps', () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.has('PlainStepper-hidden')).toBe(false);
		});

		it('includes outputSchema when defined', () => {
			const stepper = new ProductStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get('ProductStepper-getCount');
			expect(tool?.outputSchema).toBeDefined();
		});

		it('builds input schema with required params', () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get('PlainStepper-greet');
			expect(tool?.inputSchema.required).toContain('name');
			expect(tool?.inputSchema.properties?.['name']).toBeDefined();
		});
	});

	describe('validateToolInput', () => {
		it('passes valid input', () => {
			const tool: StepTool = {
				name: 'test',
				description: 'test',
				inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
				paramSchemas: new Map([['x', z.string()]]),
				stepperName: 'Test',
				stepName: 'test',
				handler: async () => ({ ok: true, products: {} }),
			};
			const result = validateToolInput(tool, { x: 'hello' });
			expect(result.x).toBe('hello');
		});

		it('throws on missing required input', () => {
			const tool: StepTool = {
				name: 'test',
				description: 'test',
				inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
				paramSchemas: new Map([['x', z.string()]]),
				stepperName: 'Test',
				stepName: 'test',
				handler: async () => ({ ok: true, products: {} }),
			};
			expect(() => validateToolInput(tool, {})).toThrow(/validation failed.*"x": required/);
		});

		it('throws on invalid type', () => {
			const tool: StepTool = {
				name: 'test',
				description: 'test',
				inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
				paramSchemas: new Map([['x', z.number()]]),
				stepperName: 'Test',
				stepName: 'test',
				handler: async () => ({ ok: true, products: {} }),
			};
			expect(() => validateToolInput(tool, { x: 'not-a-number' })).toThrow(/validation failed/);
		});
	});

	describe('createStepHandler', () => {
		it('returns ok with products for successful step with products', async () => {
			const stepper = new ProductStepper();
			const stepDef = stepper.steps.getCount;
			const handler = createStepHandler('ProductStepper', 'getCount', stepDef);
			const result = await handler({});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.products).toMatchObject({ count: 42 });
				expect(result.products._seqPath).toEqual([0]);
			}
		});

		it('returns ok with _seqPath in products for plain step', async () => {
			const stepper = new PlainStepper();
			const stepDef = stepper.steps.greet;
			const handler = createStepHandler('PlainStepper', 'greet', stepDef);
			const result = await handler({ name: 'world' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.products._seqPath).toEqual([0]);
			}
		});

		it('uses provided seqPath in products', async () => {
			const stepper = new ProductStepper();
			const stepDef = stepper.steps.getCount;
			const handler = createStepHandler('ProductStepper', 'getCount', stepDef);
			const result = await handler({}, [2, 3, 4]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.products._seqPath).toEqual([2, 3, 4]);
			}
		});

		it('returns error for failed step', async () => {
			const stepper = new ProductStepper();
			const stepDef = stepper.steps.failStep;
			const handler = createStepHandler('ProductStepper', 'failStep', stepDef);
			const result = await handler({});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('intentional failure');
			}
		});

		it('catches thrown errors', async () => {
			const stepper = new ProductStepper();
			const stepDef = stepper.steps.throwStep;
			const handler = createStepHandler('ProductStepper', 'throwStep', stepDef);
			const result = await handler({});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('boom');
			}
		});

		it('populates stepValuesMap from input', async () => {
			let capturedFeatureStep: unknown;
			const stepDef = {
				gwta: 'say hello to {name}',
				action: (_args: Record<string, unknown>, featureStep: unknown) => {
					capturedFeatureStep = featureStep;
					return OK;
				},
			};
			const handler = createStepHandler('Test', 'greet', stepDef as TStepperStep);
			await handler({ name: 'world' });
			const fs = capturedFeatureStep as { action: { stepValuesMap?: Record<string, unknown> } };
			expect(fs.action.stepValuesMap).toBeDefined();
			expect(fs.action.stepValuesMap?.['name']).toBeDefined();
		});
	});
});
