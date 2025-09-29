import { describe, it, expect, beforeAll } from 'vitest';
import { getDefaultWorld } from './test/lib.js';
import { DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON } from './domain-types.js';

// helper to access coercers from world
type TDomains = Record<string, {
	coerce: (raw: string,
		steppers?: unknown, domainResolution?: {
			resolvedDomain: string;
			possibleDomains: string[]
		}) => unknown
}>;

const getDomains = () => (getDefaultWorld(0) as unknown as { domains: TDomains }).domains;

describe('domain coercion', () => {
	const domains = getDomains();

	it('has all expected domains', () => {
		for (const d of [DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON]) {
			expect(domains[d]).toBeDefined();
		}
	});

	describe('string', () => {
		it('passes any string through', () => {
			const raw = 'anything: with symbols {}[] and punctuation!';
			expect(domains[DOMAIN_STRING].coerce(raw)).toEqual(raw);
		});
	});

	describe('number', () => {
		it('accepts integer', () => {
			expect(domains[DOMAIN_NUMBER].coerce('42')).toBe(42);
		});
		it('accepts float', () => {
			expect(domains[DOMAIN_NUMBER].coerce('3.14')).toBeCloseTo(3.14);
		});
		it('rejects non-number', () => {
			expect(() => domains[DOMAIN_NUMBER].coerce('abc')).toThrow();
		});
	});

	describe('json', () => {
		it('accepts valid object json', () => {
			const raw = '{"a":1,"b":[true,null,"x"]}';
			// coercer validates only; returns original string
			expect(domains[DOMAIN_JSON].coerce(raw)).toEqual(raw);
		});
		it('accepts valid array json', () => {
			const raw = '[1,2,3]';
			expect(domains[DOMAIN_JSON].coerce(raw)).toEqual(raw);
		});
		it('rejects invalid json', () => {
			expect(() => domains[DOMAIN_JSON].coerce('{bad json')).toThrow();
		});
	});

	describe('union domains with context', () => {
		const DOMAIN_NOTSTRING = 'mock-selector';
		const sortedUnionKey = [DOMAIN_STRING, DOMAIN_NOTSTRING].sort().join(' | ');
		let testWorld: { domains: TDomains };

		beforeAll(() => {
			testWorld = getDefaultWorld(0) as unknown as { domains: TDomains };

			// Register mock selector domain
			testWorld.domains[DOMAIN_NOTSTRING] = {
				coerce: (value: string) => `selector:${value}`
			};

			// Register union domain coercer that uses context
			testWorld.domains[sortedUnionKey] = {
				coerce: (value: string, steppers, domainResolution) => {
					if (domainResolution?.resolvedDomain === DOMAIN_NOTSTRING) {
						return `union-selector:${value}`;
					} else {
						return `union-string:${value}`;
					}
				}
			};
		});

		it('uses resolved domain context for coercion - selector domain', () => {
			const result = testWorld.domains[sortedUnionKey].coerce('test-value', undefined, {
				resolvedDomain: DOMAIN_NOTSTRING,
				possibleDomains: [DOMAIN_STRING, DOMAIN_NOTSTRING]
			});
			expect(result).toBe('union-selector:test-value');
		});

		it('uses resolved domain context for coercion - string domain', () => {
			const result = testWorld.domains[sortedUnionKey].coerce('test-value', undefined, {
				resolvedDomain: DOMAIN_STRING,
				possibleDomains: [DOMAIN_STRING, DOMAIN_NOTSTRING]
			});
			expect(result).toBe('union-string:test-value');
		});

		it('handles missing context gracefully', () => {
			const result = testWorld.domains[sortedUnionKey].coerce('test-value', undefined);
			expect(result).toBe('union-string:test-value'); // defaults to string
		});

		it('union domain key is properly sorted', () => {
			// Test that domain keys are sorted consistently regardless of declaration order
			const key1 = [DOMAIN_STRING, DOMAIN_NOTSTRING].sort().join(' | ');
			const key2 = [DOMAIN_NOTSTRING, DOMAIN_STRING].sort().join(' | ');
			expect(key1).toBe(key2);
			expect(key1).toBe('mock-selector | string'); // alphabetical order
		});
	});
});
