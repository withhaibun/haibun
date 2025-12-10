import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureVariables } from './feature-variables.js';
import { TWorld, Origin } from './defs.js';
import { getDefaultWorld } from './test/lib.js';
import { DOMAIN_STRING } from './domain-types.js';


describe('FeatureVariables - Union Domains', () => {
  let world: TWorld;
  let variables: FeatureVariables;

  beforeEach(() => {
    world = getDefaultWorld(0);
    variables = new FeatureVariables(world);
  });

  it('should resolve literal string when domain is "string | other"', () => {
    // "string" is a built-in domain in default world
    const result = variables.resolveVariable({
      term: 'literalValue',
      origin: Origin.quoted, // or Origin.defined with literal fallback
      domain: `string | other`
    });

    expect(result.value).toBe('literalValue');
    expect(result.domain).toBe(DOMAIN_STRING);
  });

  it('should resolve unquoted literal when domain is "string | other"', () => {
    const result = variables.resolveVariable({
      term: '/path/to/literal', // simple identifiers are not literals
      origin: Origin.defined,
      domain: `string | other`
    });

    expect(result.value).toBe('/path/to/literal');
    // It specifically falls back to string domain because 'string' is in the candidates
    expect(result.domain).toBe(DOMAIN_STRING);
  });

  it('should coerce using resolved domain', () => {
    // When resolving a literal-like term, it falls back to string domain
    // and coerces using that domain
    const result = variables.resolveVariable({
      term: '/some/path',
      origin: Origin.defined,
      domain: `invalid | mockDomain` // input domain is ignored for literal fallback
    });

    // Literal fallback resolves to string domain and coerces
    expect(result.value).toBe('/some/path');
    expect(result.domain).toBe(DOMAIN_STRING);
  });
});

