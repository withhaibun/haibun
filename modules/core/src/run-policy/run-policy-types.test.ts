import { describe, it, expect } from 'vitest';
import {
  parseDirFilters,
  parseRunPolicyArgs,
  parseRunPolicyEnv,
  accessLevelIncludes,
  getFeatureAccessPrefix,
  featureMatchesFilter,
  OPTION_RUN_POLICY,
  HAIBUN_RUN_POLICY,
} from './run-policy-types.js';

describe('parseDirFilters', () => {
  it('parses single pair', () => {
    expect(parseDirFilters('smoke:r')).toEqual([{ dir: 'smoke', access: 'r' }]);
  });
  it('parses multiple pairs', () => {
    expect(parseDirFilters('smoke:r,api:a,web:w')).toEqual([
      { dir: 'smoke', access: 'r' },
      { dir: 'api', access: 'a' },
      { dir: 'web', access: 'w' },
    ]);
  });
  it('throws on missing access', () => {
    expect(() => parseDirFilters('smoke')).toThrow();
  });
  it('parses invalid access level (deferred validation)', () => {
    expect(parseDirFilters('smoke:x')).toEqual([{ dir: 'smoke', access: 'x' }]);
  });
});

describe('parseRunPolicyArgs', () => {
  it('parses valid args', () => {
    const config = parseRunPolicyArgs('prod', 'smoke:r,api:a');
    expect(config.place).toBe('prod');
    expect(config.dirFilters).toHaveLength(2);
  });
  it('throws on missing env', () => {
    expect(() => parseRunPolicyArgs('', 'smoke:r')).toThrow(/Run policy configuration failed/);
  });
  it('throws on missing dirAccess', () => {
    expect(() => parseRunPolicyArgs('prod', '')).toThrow();
  });
});

describe('parseRunPolicyEnv', () => {
  it('parses valid env string', () => {
    const config = parseRunPolicyEnv('local smoke:r,api:w');
    expect(config.place).toBe('local');
    expect(config.dirFilters).toHaveLength(2);
  });
  it('throws on wrong number of parts', () => {
    expect(() => parseRunPolicyEnv('local')).toThrow(/Invalid format/);
  });
});

describe('accessLevelIncludes', () => {
  it('r includes r', () => expect(accessLevelIncludes('r', 'r')).toBe(true));
  it('a includes r', () => expect(accessLevelIncludes('a', 'r')).toBe(true));
  it('a includes a', () => expect(accessLevelIncludes('a', 'a')).toBe(true));
  it('w includes r', () => expect(accessLevelIncludes('w', 'r')).toBe(true));
  it('w includes a', () => expect(accessLevelIncludes('w', 'a')).toBe(true));
  it('w includes w', () => expect(accessLevelIncludes('w', 'w')).toBe(true));
  it('r does not include a', () => expect(accessLevelIncludes('r', 'a')).toBe(false));
  it('r does not include w', () => expect(accessLevelIncludes('r', 'w')).toBe(false));
  it('a does not include w', () => expect(accessLevelIncludes('a', 'w')).toBe(false));
});

describe('getFeatureAccessPrefix', () => {
  it('detects r_ prefix', () => expect(getFeatureAccessPrefix('r_health.feature')).toBe('r'));
  it('detects a_ prefix', () => expect(getFeatureAccessPrefix('a_auth.feature')).toBe('a'));
  it('detects w_ prefix', () => expect(getFeatureAccessPrefix('w_write.feature')).toBe('w'));
  it('returns undefined for no prefix', () => expect(getFeatureAccessPrefix('health.feature')).toBeUndefined());
  it('returns undefined for unrecognized prefix', () => expect(getFeatureAccessPrefix('x_bad.feature')).toBeUndefined());
  it('returns undefined for kireji without prefix', () => expect(getFeatureAccessPrefix('test.feature.ts')).toBeUndefined());
  it('detects prefix on kireji files', () => expect(getFeatureAccessPrefix('r_test.feature.ts')).toBe('r'));
});

describe('featureMatchesFilter', () => {
  const filters = [
    { dir: 'smoke', access: 'r' as const },
    { dir: 'api', access: 'a' as const },
  ];

  it('allows r_ in smoke (r granted)', () => {
    expect(featureMatchesFilter('/smoke/r_health.feature', filters)).toBe(true);
  });
  it('blocks a_ in smoke (only r granted)', () => {
    expect(featureMatchesFilter('/smoke/a_auth.feature', filters)).toBe(false);
  });
  it('allows r_ in api (a granted, includes r)', () => {
    expect(featureMatchesFilter('/api/r_list.feature', filters)).toBe(true);
  });
  it('allows a_ in api (a granted)', () => {
    expect(featureMatchesFilter('/api/a_profile.feature', filters)).toBe(true);
  });
  it('blocks w_ in api (only a granted)', () => {
    expect(featureMatchesFilter('/api/w_create.feature', filters)).toBe(false);
  });
  it('skips unprefixed files silently', () => {
    expect(featureMatchesFilter('/smoke/health.feature', filters)).toBe(false);
  });
  it('skips files in unlisted directories', () => {
    expect(featureMatchesFilter('/web/r_page.feature', filters)).toBe(false);
  });
  it('skips files with no directory', () => {
    expect(featureMatchesFilter('/r_orphan.feature', filters)).toBe(false);
  });

  it('allows wildcard dir filter for any directory', () => {
    const wildcardFilters = [{ dir: '*', access: 'r' as const }];
    expect(featureMatchesFilter('/api/r_health.feature', wildcardFilters)).toBe(true);
  });

  it('applies access checks for wildcard dir filter', () => {
    const wildcardFilters = [{ dir: '*', access: 'r' as const }];
    expect(featureMatchesFilter('/api/a_auth.feature', wildcardFilters)).toBe(false);
  });

  it('prefers explicit directory rule over wildcard', () => {
    const mixedFilters = [
      { dir: '*', access: 'r' as const },
      { dir: 'api', access: 'a' as const },
    ];
    expect(featureMatchesFilter('/api/a_auth.feature', mixedFilters)).toBe(true);
  });
});
