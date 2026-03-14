import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getDefaultWorld } from './test/lib.js';
import { DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON, DOMAIN_DATE, registerDomains, asDomainKey, createEnumDomainDefinition } from './domain-types.js';
import { TDomainDefinition } from './defs.js';
import { Origin, TStepValue } from '../schema/protocol.js';
import { FeatureVariables } from './feature-variables.js';

const p = (value: string, domain = DOMAIN_STRING): TStepValue => ({ term: String(value), value, domain, origin: Origin.var });

describe('domain coercion', () => {
	const domains = getDefaultWorld().domains;

	it('has all expected domains', () => {
		for (const d of [DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON]) {
			expect(domains[d]).toBeDefined();
		}
	});

	describe('string', () => {
		it('passes any string through', () => {
			const raw = 'anything: with symbols {}[] and punctuation!';
			expect(domains[DOMAIN_STRING].coerce(p(raw))).toEqual(raw);
		});
	});

	describe('number', () => {
		it('accepts integer', () => {
			expect(domains[DOMAIN_NUMBER].coerce(p('42', DOMAIN_NUMBER))).toBe(42);
		});
		it('accepts float', () => {
			expect(domains[DOMAIN_NUMBER].coerce(p('3.14', DOMAIN_NUMBER))).toBeCloseTo(3.14);
		});
		it('rejects non-number', () => {
			expect(() => domains[DOMAIN_NUMBER].coerce(p('1abc', DOMAIN_NUMBER))).toThrow();
		});
	});

	describe('json', () => {
		it('accepts valid object json', () => {
			const raw = '{"a":1,"b":[true,null,"x"]}';
			// coercer validates only; returns original string
			expect(domains[DOMAIN_JSON].coerce(p(raw))).toEqual(JSON.parse(raw));
		});
		it('accepts valid array json', () => {
			const raw = '[1,2,3]';
			expect(domains[DOMAIN_JSON].coerce(p(raw))).toEqual(JSON.parse(raw));
		});
		it('rejects invalid json', () => {
			expect(() => domains[DOMAIN_JSON].coerce(p('{bad json', DOMAIN_JSON))).toThrow();
		});
	});

	describe('date', () => {
		it('parses ISO timestamps', () => {
			const date = domains[DOMAIN_DATE].coerce(p('2024-12-03T10:00:00Z', DOMAIN_DATE)) as Date;
			expect(date).toBeInstanceOf(Date);
			expect(date.toISOString()).toBe('2024-12-03T10:00:00.000Z');
		});
		it('rejects invalid dates', () => {
			expect(() => domains[DOMAIN_DATE].coerce(p('not-a-date', DOMAIN_DATE))).toThrow();
		});
	});

		describe('union domains with context', () => {
		const DOMAIN_NOTSTRING = 'mock-selector';
		const mixed = [DOMAIN_STRING, DOMAIN_NOTSTRING]
		const testWorld = getDefaultWorld();
		const domains: TDomainDefinition[] = [{
			selectors: mixed,
			schema: z.string(),
			coerce: (proto: TStepValue) => (proto.domain === DOMAIN_NOTSTRING) ? `notstring:${proto.value}` : `string:${proto.value}`
		},
		{
			selectors: [DOMAIN_NOTSTRING],
			schema: z.string(),
			coerce: (proto: TStepValue) => `selector:${proto.value}`
		}];
		registerDomains(testWorld, [domains]);

		it('uses resolved domain context for coercion - selector domain', () => {
			const result = testWorld.domains[asDomainKey(mixed)].coerce(p('test-value', DOMAIN_NOTSTRING));
			expect(result).toBe('notstring:test-value');
		});

		it('uses resolved domain context for coercion - string domain', () => {
			const result = testWorld.domains[asDomainKey(mixed)].coerce(p('test-value'));
			expect(result).toBe('string:test-value');
		});
	});

		describe('progress stage domain example', () => {
		const DOMAIN_PROGRESS_STAGE = 'progress-stage';
		const PROGRESS_STAGES = ['proto', 'started', 'in-process', 'finished'] as const;
		const progressWorld = getDefaultWorld();
			const stageDefinition = createEnumDomainDefinition({ name: DOMAIN_PROGRESS_STAGE, values: [...PROGRESS_STAGES], ordered: true });
		registerDomains(progressWorld, [[stageDefinition]]);

		it('accepts valid stages and rejects invalid', () => {
			const result = progressWorld.domains[DOMAIN_PROGRESS_STAGE].coerce(p('started', DOMAIN_PROGRESS_STAGE));
			expect(result).toBe('started');
			expect(() => progressWorld.domains[DOMAIN_PROGRESS_STAGE].coerce(p('invalid', DOMAIN_PROGRESS_STAGE))).toThrow();
		});

			it('compares magnitude ordering', () => {
				const comparator = progressWorld.domains[DOMAIN_PROGRESS_STAGE].comparator;
			expect(comparator).toBeDefined();
			if (!comparator) return; // type guard for TypeScript
			expect(comparator('in-process', 'started')).toBeGreaterThan(0);
			expect(comparator('started', 'finished')).toBeLessThan(0);
			expect(comparator('proto', 'proto')).toBe(0);
		});
	});

	describe('structured object domain with objectCoercer', () => {
		const DOMAIN_STRUCTURED = 'test-structured';
		const structuredSchema = z.object({
			conditions: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
			type: z.string().optional(),
		});

		const structuredWorld = getDefaultWorld();
		const objectCoercer = (schema: z.ZodType) => (proto: TStepValue) => {
			const value = typeof proto.value === 'string' ? JSON.parse(proto.value) : proto.value;
			return schema.parse(value);
		};
		registerDomains(structuredWorld, [[{
			selectors: [DOMAIN_STRUCTURED],
			schema: structuredSchema,
			coerce: objectCoercer(structuredSchema),
		}]]);

		it('parses JSON string into validated object', () => {
			const json = JSON.stringify({ conditions: [{ field: 'a', value: 'b' }], type: 'Email' });
			const result = structuredWorld.domains[DOMAIN_STRUCTURED].coerce(p(json, DOMAIN_STRUCTURED));
			expect(result).toEqual({ conditions: [{ field: 'a', value: 'b' }], type: 'Email' });
		});

		it('passes object through directly', () => {
			const obj = { conditions: [], type: 'Test' };
			const proto = { term: JSON.stringify(obj), value: obj, domain: DOMAIN_STRUCTURED, origin: Origin.var } as TStepValue;
			const result = structuredWorld.domains[DOMAIN_STRUCTURED].coerce(proto);
			expect(result).toEqual({ conditions: [], type: 'Test' });
		});

		it('applies schema defaults for missing fields', () => {
			const json = JSON.stringify({});
			const result = structuredWorld.domains[DOMAIN_STRUCTURED].coerce(p(json, DOMAIN_STRUCTURED));
			expect(result).toEqual({ conditions: [] });
		});

		it('rejects invalid JSON', () => {
			expect(() => structuredWorld.domains[DOMAIN_STRUCTURED].coerce(p('{bad', DOMAIN_STRUCTURED))).toThrow();
		});

		it('rejects non-object JSON (array)', () => {
			expect(() => structuredWorld.domains[DOMAIN_STRUCTURED].coerce(p('[]', DOMAIN_STRUCTURED))).toThrow();
		});
	});

	describe('resolveVariable uses declared domain for quoted values', () => {
		const DOMAIN_STRUCTURED = 'test-resolve-structured';
		const structuredSchema = z.object({
			items: z.array(z.string()).default([]),
		});
		const objectCoercer = (schema: z.ZodType) => (proto: TStepValue) => {
			const value = typeof proto.value === 'string' ? JSON.parse(proto.value) : proto.value;
			return schema.parse(value);
		};

		const testWorld = getDefaultWorld();
		registerDomains(testWorld, [[{
			selectors: [DOMAIN_STRUCTURED],
			schema: structuredSchema,
			coerce: objectCoercer(structuredSchema),
		}]]);

		it('coerces JSON string through structured domain when declared', () => {
			const fv = new FeatureVariables(testWorld);
			const result = fv.resolveVariable({
				term: JSON.stringify({ items: ['a', 'b'] }),
				origin: Origin.quoted,
				domain: DOMAIN_STRUCTURED,
			});
			expect(result.value).toEqual({ items: ['a', 'b'] });
			expect(result.domain).toBe(DOMAIN_STRUCTURED);
		});

		it('throws for unknown single domain', () => {
			const fv = new FeatureVariables(testWorld);
			expect(() => fv.resolveVariable({
				term: 'hello',
				origin: Origin.quoted,
				domain: 'nonexistent',
			})).toThrow('unknown domain');
		});
	});
});
