import { describe, it, expect } from 'vitest';
import { validateRunPolicyConfig } from './run-policy-schema.js';
import type { TRunPolicyConfig } from './run-policy-types.js';
import type { TRunPolicy } from './run-policy-schema.js';

import { ACCESS_LEVELS } from './run-policy-types.js';

/** Helper: build a policy in hierarchical JSON Schema format */
function makePolicy(envs: string[], dirs: string[], deny: Array<{ env?: string; dir?: string; access?: string }> = []): TRunPolicy {
  return {
    type: 'object',
    properties: {
      env: { type: 'string', enum: envs },
      dirFilters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dir: { type: 'string', enum: dirs },
            access: { type: 'string', enum: [...ACCESS_LEVELS] }
          },
          required: ['dir', 'access']
        }
      }
    },
    deny: deny as TRunPolicy['deny'],
  };
}

const SCHEMA_PATH = 'test.json';

describe('validateRunPolicyConfig', () => {
  const policy = makePolicy(
    ['local', 'dev', 'test', 'prod'],
    ['smoke', 'api', 'web'],
    [
      { env: 'prod', access: 'w' },
      { env: 'prod', dir: 'api', access: 'a' },
    ],
  );

  it('accepts valid config', () => {
    const config: TRunPolicyConfig = {
      env: 'local',
      dirFilters: [{ dir: 'smoke', access: 'r' }],
    };
    expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
  });

  it('rejects unknown environment via enum', () => {
    const config: TRunPolicyConfig = {
      env: 'staging',
      dirFilters: [{ dir: 'smoke', access: 'r' }],
    };
    const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown directory via enum', () => {
    const config: TRunPolicyConfig = {
      env: 'local',
      dirFilters: [{ dir: 'regression', access: 'r' }],
    };
    const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('catches deny rule: w in prod', () => {
    const config: TRunPolicyConfig = {
      env: 'prod',
      dirFilters: [{ dir: 'smoke', access: 'w' }],
    };
    const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('Denied'))).toBe(true);
  });

  it('catches deny rule: a in prod api', () => {
    const config: TRunPolicyConfig = {
      env: 'prod',
      dirFilters: [{ dir: 'api', access: 'a' }],
    };
    const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
    expect(errors.some((e) => e.includes('Denied'))).toBe(true);
  });

  it('allows r in prod (no deny rule for it)', () => {
    const config: TRunPolicyConfig = {
      env: 'prod',
      dirFilters: [{ dir: 'smoke', access: 'r' }],
    };
    expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
  });
});
