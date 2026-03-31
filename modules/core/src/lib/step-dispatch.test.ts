import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import { buildStepRegistry, validateToolInput, stepMethodName, createStepHandler, discoverSteps, buildSyntheticFeatureStep, authorizeToolCapability, capabilityAllows, dispatchRemoteToolCall, type StepTool } from './step-dispatch.js';
import { AStepper } from './astepper.js';
import { OK } from '../schema/protocol.js';
import { actionOKWithProducts, actionNotOK } from './util/index.js';
import { getDefaultWorld } from './test/lib.js';
import { registerDomains } from './domain-types.js';
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
			exposeMCP: false,
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

class CapabilityStepper extends AStepper {
	steps = {
		protectedPing: {
			gwta: 'protected ping',
			capability: 'CapabilityStepper:protected',
			action: () => OK,
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

		it('includes exposeMCP:false steps in registry (MCP filters separately)', () => {
			const stepper = new PlainStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.has('PlainStepper-hidden')).toBe(true);
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

		it('propagates step capability metadata', () => {
			const stepper = new CapabilityStepper();
			const registry = buildStepRegistry([stepper], world);
			expect(registry.get('CapabilityStepper-protectedPing')?.capability).toBe('CapabilityStepper:protected');
		});
	});

	describe('authorizeToolCapability', () => {
		it('allows exact capability match', () => {
			expect(capabilityAllows('CapabilityStepper:protected', 'CapabilityStepper:protected')).toBe(true);
		});

		it('allows wildcard capability prefix', () => {
			expect(capabilityAllows('CapabilityStepper:*', 'CapabilityStepper:protected')).toBe(true);
		});

		it('allows a required capability from a zcap-like grant set', () => {
			expect(
				capabilityAllows(
					['Other:*', 'CapabilityStepper:protected'],
					'CapabilityStepper:protected',
				),
			).toBe(true);
		});

		it('rejects missing or wrong capability', () => {
			const tool = { name: 'CapabilityStepper-protectedPing', capability: 'CapabilityStepper:protected' };
			expect(() => authorizeToolCapability(tool, undefined)).toThrow(/capability CapabilityStepper:protected required/);
			expect(() => authorizeToolCapability(tool, 'Other:*')).toThrow(/capability CapabilityStepper:protected required/);
		});
	});

	describe('validateToolInput', () => {
		const makeTool = (overrides: Partial<StepTool> & { paramSchemas: StepTool['paramSchemas'] }): StepTool => ({
			name: 'test',
			description: 'test',
			inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
			paramDomainKeys: new Map(),
			stepperName: 'Test',
			stepName: 'test',
			handler: async () => ({ ok: true }),
			...overrides,
		});

		it('passes valid input', () => {
			const tool = makeTool({ paramSchemas: new Map([['x', z.string()]]) });
			const result = validateToolInput(tool, { x: 'hello' });
			expect(result.x).toBe('hello');
		});

		it('throws on missing required input', () => {
			const tool = makeTool({ paramSchemas: new Map([['x', z.string()]]) });
			expect(() => validateToolInput(tool, {})).toThrow(/validation failed.*"x": required/);
		});

		it('throws on invalid type', () => {
			const tool = makeTool({
				inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
				paramSchemas: new Map([['x', z.number()]]),
			});
			expect(() => validateToolInput(tool, { x: 'not-a-number' })).toThrow(/validation failed/);
		});

		it('applies domain.coerce() when world is provided', () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{
				selectors: ['myDomain'],
				schema: z.string(),
				coerce: (proto) => String(proto.value).toUpperCase(),
			}]]);
			const stepper = new class extends AStepper {
				steps = { doIt: { gwta: 'do it with {val: myDomain}', action: async () => OK } };
			}();
			const registry = buildStepRegistry([stepper], w);
			const tool = registry.get(`${stepper.constructor.name}-doIt`);
			if (!tool) throw new Error('Expected tool to be registered');
			const result = validateToolInput(tool, { val: 'hello' }, w);
			expect(result.val).toBe('HELLO');
		});

		it('skips coerce when world is not provided', () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{
				selectors: ['myDomain'],
				schema: z.string(),
				coerce: (proto) => String(proto.value).toUpperCase(),
			}]]);
			const stepper = new class extends AStepper {
				steps = { doIt: { gwta: 'do it with {val: myDomain}', action: async () => OK } };
			}();
			const registry = buildStepRegistry([stepper], w);
			const tool = registry.get(`${stepper.constructor.name}-doIt`);
			if (!tool) throw new Error('Expected tool to be registered');
			// Without world, no coercion — returns Zod-parsed value as-is
			const result = validateToolInput(tool, { val: 'hello' });
			expect(result.val).toBe('hello');
		});
	});

	describe('discoverSteps', () => {
		it('returns steps and domains', () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{
				selectors: ['color'],
				schema: z.enum(['red', 'green', 'blue']),
				values: ['red', 'green', 'blue'],
				description: 'A color',
			}]]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps([stepper], w);
			expect(Array.isArray(discovery.steps)).toBe(true);
			expect(discovery.steps.some(m => m.method === 'PlainStepper-greet')).toBe(true);
			expect(discovery.domains).toBeDefined();
			expect(discovery.domains['color']).toMatchObject({ description: 'A color', values: ['red', 'green', 'blue'] });
		});

		it('extracts enum values from z.enum domain schema when values not explicitly set', () => {
			const w = getDefaultWorld();
			registerDomains(w, [[{
				selectors: ['size'],
				schema: z.enum(['small', 'medium', 'large']),
				description: 'T-shirt size',
			}]]);
			const stepper = new PlainStepper();
			const discovery = discoverSteps([stepper], w);
			expect(discovery.domains['size']).toMatchObject({ description: 'T-shirt size', values: ['small', 'medium', 'large'] });
		});

		it('step.list steps includes inputSchema', () => {
			const stepper = new PlainStepper();
			const discovery = discoverSteps([stepper], world);
			const greet = discovery.steps.find(m => m.method === 'PlainStepper-greet');
			expect(greet?.inputSchema).toBeDefined();
			expect(greet?.inputSchema?.required).toContain('name');
		});

		it('step.list steps includes capability', () => {
			const stepper = new CapabilityStepper();
			const discovery = discoverSteps([stepper], world);
			expect(discovery.steps.find(m => m.method === 'CapabilityStepper-protectedPing')?.capability).toBe('CapabilityStepper:protected');
		});
	});

	describe('createStepHandler', () => {
		const synth = (tool: { stepperName: string; stepName: string; description: string }, input: Record<string, unknown>, seqPath: number[] = [0]) =>
			buildSyntheticFeatureStep(tool as StepTool, input, seqPath);

		it('returns ok with products for successful step with products', async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler('ProductStepper', 'getCount', stepper.steps.getCount);
			const result = await handler(synth({ stepperName: 'ProductStepper', stepName: 'getCount', description: '' }, {}), world);
			expect(result.ok).toBe(true);
			expect(result.products).toMatchObject({ count: 42 });
			expect(result.products?._seqPath).toEqual([0]);
		});

		it('returns ok for plain step', async () => {
			const stepper = new PlainStepper();
			const handler = createStepHandler('PlainStepper', 'greet', stepper.steps.greet);
			const result = await handler(synth({ stepperName: 'PlainStepper', stepName: 'greet', description: 'greet {name}' }, { name: 'world' }), world);
			expect(result.ok).toBe(true);
		});

		it('uses provided seqPath in products', async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler('ProductStepper', 'getCount', stepper.steps.getCount);
			const result = await handler(synth({ stepperName: 'ProductStepper', stepName: 'getCount', description: '' }, {}, [2, 3, 4]), world);
			expect(result.ok).toBe(true);
			expect(result.products?._seqPath).toEqual([2, 3, 4]);
		});

		it('returns errorMessage for failed step', async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler('ProductStepper', 'failStep', stepper.steps.failStep);
			const result = await handler(synth({ stepperName: 'ProductStepper', stepName: 'failStep', description: '' }, {}), world);
			expect(result.ok).toBe(false);
			expect(result.errorMessage).toBe('intentional failure');
		});

		it('catches thrown errors', async () => {
			const stepper = new ProductStepper();
			const handler = createStepHandler('ProductStepper', 'throwStep', stepper.steps.throwStep);
			const result = await handler(synth({ stepperName: 'ProductStepper', stepName: 'throwStep', description: '' }, {}), world);
			expect(result.ok).toBe(false);
			expect(result.errorMessage).toContain('boom');
		});

		it('populates stepValuesMap from input', async () => {
			let capturedFeatureStep: unknown;
			const stepDef = {
				gwta: 'say hello to {name}',
				action: (_args: Record<string, unknown>, featureStep: unknown) => { capturedFeatureStep = featureStep; return OK; },
			};
			const handler = createStepHandler('Test', 'greet', stepDef as TStepperStep);
			await handler(synth({ stepperName: 'Test', stepName: 'greet', description: 'say hello to {name}' }, { name: 'world' }), world);
			const fs = capturedFeatureStep as { action: { stepValuesMap?: Record<string, unknown> } };
			expect(fs.action.stepValuesMap).toBeDefined();
			expect(fs.action.stepValuesMap?.['name']).toBeDefined();
		});
	});

	describe('dispatchRemoteToolCall', () => {
		it('uses the common root to validate, authorize, and preserve seqPath', async () => {
			const stepper = new class extends AStepper {
				steps = {
					protectedEcho: {
						gwta: 'protected echo {message}',
						capability: 'Remote:invoke',
						action: async ({ message }: { message: string }) => actionOKWithProducts({ echoed: message }),
					},
				};
			}();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get(`${stepper.constructor.name}-protectedEcho`);
			if (!tool) throw new Error('Expected protected tool to be registered');

			const result = await dispatchRemoteToolCall({
				tool,
				input: { message: 'hello' },
				world,
				seqPath: [0, 7],
				grantedCapability: 'Remote:invoke',
			});

			expect(result.ok).toBe(true);
			expect(result.products).toMatchObject({ echoed: 'hello', _seqPath: [0, 7] });
		});

		it('denies missing capability at the common root', async () => {
			const stepper = new CapabilityStepper();
			const registry = buildStepRegistry([stepper], world);
			const tool = registry.get('CapabilityStepper-protectedPing');
			if (!tool) throw new Error('Expected protected tool to be registered');

			await expect(
				dispatchRemoteToolCall({
					tool,
					input: {},
					world,
					seqPath: [0, 1],
				})
			).rejects.toThrow(/capability CapabilityStepper:protected required/);
		});
	});
});
