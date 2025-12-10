import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureVariables } from './feature-variables.js';
import { TWorld, TStepValue, Origin, TFeatureStep } from './defs.js';
import { getDefaultWorld } from './test/lib.js';
import { DOMAIN_JSON, DOMAIN_STRING } from './domain-types.js';

describe('FeatureVariables', () => {
	let world: TWorld;
	let variables: FeatureVariables;
	const mockFeatureStep: TFeatureStep = {
		path: '/test/feature.ts',
		in: 'test step',
		seqPath: [1, 2, 3],
		action: {
			actionName: 'testAction',
			stepperName: 'TestStepper',
			step: {
				gwta: 'test',
				action: () => Promise.resolve({ ok: true })
			}
		}
	};

	beforeEach(() => {
		world = getDefaultWorld(0);
		variables = new FeatureVariables(world);
	});

	describe('constructor', () => {
		it('should initialize with empty values', () => {
			const vars = new FeatureVariables(world);
			expect(vars.all()).toEqual({});
		});

		it('should initialize with initial values', () => {
			const initial: { [name: string]: TStepValue } = {
				foo: { term: 'foo', value: 'bar', domain: DOMAIN_STRING, origin: Origin.var }
			};
			const vars = new FeatureVariables(world, initial);
			expect(vars.all()).toEqual(initial);
		});
	});

	describe('clear', () => {
		it('should clear all variables', () => {
			variables.set(
				{ term: 'foo', value: 'bar', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);
			expect(variables.get('foo')).toBe('bar');

			variables.clear();
			expect(variables.all()).toEqual({});
			expect(variables.get('foo')).toBeUndefined();
		});
	});

	describe('all', () => {
		it('should return a copy of all values', () => {
			variables.set(
				{ term: 'var1', value: 'value1', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);
			variables.set(
				{ term: 'var2', value: 'value2', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [2], when: 'test.action' }
			);

			const all = variables.all();
			expect(all).toHaveProperty('var1');
			expect(all).toHaveProperty('var2');
			expect(all.var1.value).toBe('value1');
			expect(all.var2.value).toBe('value2');
		});

		it('should return a copy, not the original', () => {
			variables.set(
				{ term: 'foo', value: 'bar', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			const all1 = variables.all();
			const all2 = variables.all();
			expect(all1).not.toBe(all2); // Different objects
			expect(all1).toEqual(all2); // Same content
		});
	});

	describe('toString', () => {
		it('should return string representation', () => {
			const str = variables.toString();
			expect(str).toContain('context');
			expect(str).toContain(world.tag);
		});
	});

	describe('set and get', () => {
		it('should set and get a string variable', () => {
			variables.set(
				{ term: 'myVar', value: 'myValue', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			expect(variables.get('myVar')).toBe('myValue');
		});

		it('should return undefined for non-existent variable', () => {
			expect(variables.get('nonExistent')).toBeUndefined();
		});

		it('should throw error for variables with dots', () => {
			expect(() => {
				variables.set(
					{ term: 'invalid.var', value: 'value', domain: DOMAIN_STRING, origin: Origin.var },
					{ in: 'test', seq: [1], when: 'test.action' }
				);
			}).toThrow('non-stepper variables cannot use dots');
		});

		it('should throw error for unknown domain', () => {
			expect(() => {
				variables.set(
					{ term: 'myVar', value: 'value', domain: 'unknownDomain', origin: Origin.var },
					{ in: 'test', seq: [1], when: 'test.action' }
				);
			}).toThrow('Cannot set variable "myVar": unknown domain "unknownDomain"');
		});

		it('should track provenance when setting variable', () => {
			const provenance = { in: 'set foo to bar', seq: [1, 2], when: 'Variables.set' };
			variables.set(
				{ term: 'foo', value: 'bar', domain: DOMAIN_STRING, origin: Origin.var },
				provenance
			);

			const all = variables.all();
			expect(all.foo.provenance).toEqual([provenance]);
		});

		it('should append to provenance on multiple sets', () => {
			const provenance1 = { in: 'set foo to bar', seq: [1], when: 'Variables.set' };
			const provenance2 = { in: 'set foo to baz', seq: [2], when: 'Variables.set' };

			variables.set(
				{ term: 'foo', value: 'bar', domain: DOMAIN_STRING, origin: Origin.var },
				provenance1
			);
			variables.set(
				{ term: 'foo', value: 'baz', domain: DOMAIN_STRING, origin: Origin.var },
				provenance2
			);

			const all = variables.all();
			expect(all.foo.provenance).toEqual([provenance1, provenance2]);
			expect(all.foo.value).toBe('baz'); // Last value wins
		});

		it('should coerce values through domain', () => {
			// The default world has domains that coerce values
			variables.set(
				{ term: 'num', value: '42', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			expect(variables.get('num')).toBe('42');
		});
	});

	describe('setForStepper', () => {
		it('should prefix variable name with stepper name', () => {
			variables.setForStepper(
				'MyStepper',
				{ term: 'myVar', value: 'myValue', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			expect(variables.get('MyStepper.myVar')).toBe('myValue');
			expect(variables.get('myVar')).toBeUndefined();
		});

		it('should allow dots in stepper-prefixed variables', () => {
			expect(() => {
				variables.setForStepper(
					'MyStepper',
					{ term: 'my.var', value: 'value', domain: DOMAIN_STRING, origin: Origin.var },
					{ in: 'test', seq: [1], when: 'test.action' }
				);
			}).not.toThrow();

			expect(variables.get('MyStepper.my.var')).toBe('value');
		});
	});

	describe('setJSON and getJSON', () => {
		it('should set and get JSON objects', () => {
			const obj = { foo: 'bar', num: 42, nested: { value: true } };

			variables.setJSON('myJson', obj, Origin.var, mockFeatureStep);

			const retrieved = variables.getJSON<typeof obj>('myJson');
			expect(retrieved).toEqual(obj);
		});

		it('should store JSON as string internally', () => {
			const obj = { foo: 'bar' };
			variables.setJSON('myJson', obj, Origin.var, mockFeatureStep);

			const all = variables.all();
			expect(all.myJson.domain).toBe(DOMAIN_JSON);
			expect(typeof all.myJson.value).toBe('string');
			expect(all.myJson.value).toBe(JSON.stringify(obj));
		});

		it('should return undefined for non-existent JSON variable', () => {
			expect(variables.getJSON('nonExistent')).toBeUndefined();
		});

		it('should throw error when getting non-JSON variable as JSON', () => {
			variables.set(
				{ term: 'notJson', value: 'just a string', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			expect(() => {
				variables.getJSON('notJson');
			}).toThrow('notJson is string, not json');
		});

		it('should handle complex JSON structures', () => {
			const complex = {
				array: [1, 2, 3],
				nested: {
					deep: {
						value: 'deeply nested'
					}
				},
				nullValue: null,
				boolValue: true
			};

			variables.setJSON('complex', complex, Origin.var, mockFeatureStep);
			const retrieved = variables.getJSON<typeof complex>('complex');

			expect(retrieved).toEqual(complex);
			expect(retrieved?.array).toEqual([1, 2, 3]);
			expect(retrieved?.nested.deep.value).toBe('deeply nested');
		});

		it('should preserve provenance for JSON variables', () => {
			const obj = { test: true };
			variables.setJSON('myJson', obj, Origin.var, mockFeatureStep);

			const all = variables.all();
			expect(all.myJson.provenance).toHaveLength(1);
			expect(all.myJson.provenance![0].in).toBe('test step');
			expect(all.myJson.provenance![0].when).toBe('TestStepper.testAction');
		});
	});

	describe('type safety with get', () => {
		it('should allow typed retrieval', () => {
			variables.set(
				{ term: 'count', value: '42', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			const count = variables.get<string>('count');
			expect(count).toBe('42');
		});

		it('should allow typed JSON retrieval', () => {
			interface User {
				name: string;
				age: number;
			}

			const user: User = { name: 'Alice', age: 30 };
			variables.setJSON('user', user, Origin.var, mockFeatureStep);

			const retrieved = variables.getJSON<User>('user');
			expect(retrieved?.name).toBe('Alice');
			expect(retrieved?.age).toBe(30);
		});
	});

	describe('origin tracking', () => {
		it('should track different origins', () => {
			variables.set(
				{ term: 'envVar', value: 'fromEnv', domain: DOMAIN_STRING, origin: Origin.env },
				{ in: 'test', seq: [1], when: 'test.action' }
			);
			variables.set(
				{ term: 'quotedVar', value: 'fromQuote', domain: DOMAIN_STRING, origin: Origin.quoted },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			const all = variables.all();
			expect(all.envVar.origin).toBe(Origin.env);
			expect(all.quotedVar.origin).toBe(Origin.quoted);
		});
	});

	describe('edge cases', () => {
		it('should handle empty string values', () => {
			variables.set(
				{ term: 'empty', value: '', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test', seq: [1], when: 'test.action' }
			);

			expect(variables.get('empty')).toBe('');
		});

		it('should handle overwriting variables', () => {
			variables.set(
				{ term: 'foo', value: 'first', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test1', seq: [1], when: 'test.action' }
			);
			variables.set(
				{ term: 'foo', value: 'second', domain: DOMAIN_STRING, origin: Origin.var },
				{ in: 'test2', seq: [2], when: 'test.action' }
			);

			expect(variables.get('foo')).toBe('second');
			expect(variables.all().foo.provenance).toHaveLength(2);
		});

		it('should handle JSON with empty objects', () => {
			variables.setJSON('empty', {}, Origin.var, mockFeatureStep);
			expect(variables.getJSON('empty')).toEqual({});
		});

		it('should handle JSON with empty arrays', () => {
			variables.setJSON('emptyArray', [], Origin.var, mockFeatureStep);
			expect(variables.getJSON('emptyArray')).toEqual([]);
		});
	});

	describe('literal fallback', () => {
		it('should fallback to literal value for unquoted literals', () => {
			const fv = new FeatureVariables(world);
			const result = fv.resolveVariable({ term: '/path/to/resource', origin: Origin.defined });
			expect(result.value).toBe('/path/to/resource');
		});

		it('should not fallback to literal for variable-like terms', () => {
			const fv = new FeatureVariables(world);
			const result = fv.resolveVariable({ term: 'undefinedVar', origin: Origin.defined });
			expect(result.value).toBeUndefined();
		});

		it('should prioritize defined variables over literal fallback', () => {
			const fv = new FeatureVariables(world);
			fv.set(
				{ term: '/path', value: 'defined value', domain: DOMAIN_STRING, origin: Origin.statement },
				{ in: 'test', seq: [0], when: 'now' }
			);
			const result = fv.resolveVariable({ term: '/path', origin: Origin.defined });
			expect(result.value).toBe('defined value');
		});
	});
});
