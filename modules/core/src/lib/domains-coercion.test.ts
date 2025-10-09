import { describe, it, expect } from 'vitest';
import { getDefaultWorld } from './test/lib.js';
import { DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON, registerDomains, asDomainKey } from './domain-types.js';
import { Origin, TDomainDefinition, TStepValue } from './defs.js';

const p = (value: string, domain = DOMAIN_STRING): TStepValue => ({ term: String(value), value, domain, origin: Origin.var });

describe('domain coercion', () => {
	const domains = getDefaultWorld(0).domains;

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
			expect(domains[DOMAIN_JSON].coerce(p(raw))).toEqual(raw);
		});
		it('accepts valid array json', () => {
			const raw = '[1,2,3]';
			expect(domains[DOMAIN_JSON].coerce(p(raw))).toEqual(raw);
		});
		it('rejects invalid json', () => {
			expect(() => domains[DOMAIN_JSON].coerce(p('{bad json', DOMAIN_JSON))).toThrow();
		});
	});

	describe('union domains with context', () => {
		const DOMAIN_NOTSTRING = 'mock-selector';
		const mixed = [DOMAIN_STRING, DOMAIN_NOTSTRING]
		const testWorld = getDefaultWorld(0);
		const domains: TDomainDefinition[] = [{
			selectors: mixed,
			coerce: (proto: TStepValue) => (proto.domain === DOMAIN_NOTSTRING) ? `notstring:${proto.value}` : `string:${proto.value}`
		},
		{
			selectors: [DOMAIN_NOTSTRING],
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
});
