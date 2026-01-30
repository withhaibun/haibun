import { describe, it, expect } from 'vitest';
import { willBeSecret, isSecretByName, HIDDEN_SECRET } from './set-modifiers.js';
import { TStepperStep, TStepValuesMap } from './defs.js';

describe('set-modifiers', () => {
  const secretStep: TStepperStep = { handlesSecret: true, action: async () => ({ ok: true }) };
  const normalStep: TStepperStep = { action: async () => ({ ok: true }) };

  describe('isSecretByName', () => {
    it('detects password in name', () => {
      expect(isSecretByName('userPassword')).toBe(true);
      expect(isSecretByName('PASSWORD')).toBe(true);
      expect(isSecretByName('my_password_field')).toBe(true);
    });

    it('returns false for non-secret names', () => {
      expect(isSecretByName('username')).toBe(false);
      expect(isSecretByName('email')).toBe(false);
    });
  });

  describe('willBeSecret', () => {
    it('returns false for steps without handlesSecret flag', () => {
      const stepValuesMap = { domain: { term: 'secret' } } as unknown as TStepValuesMap;
      expect(willBeSecret(normalStep, stepValuesMap)).toBe(false);
    });

    it('returns true for secret domain', () => {
      const stepValuesMap = { domain: { term: 'secret' }, what: { term: 'foo' } } as unknown as TStepValuesMap;
      expect(willBeSecret(secretStep, stepValuesMap)).toBe(true);
    });

    it('returns true for variable name containing password', () => {
      const stepValuesMap = { domain: { term: 'string' }, what: { term: 'userPassword' } } as unknown as TStepValuesMap;
      expect(willBeSecret(secretStep, stepValuesMap)).toBe(true);
    });

    it('returns false for non-secret domains and names', () => {
      const stepValuesMap = { domain: { term: 'string' }, what: { term: 'count' } } as unknown as TStepValuesMap;
      expect(willBeSecret(secretStep, stepValuesMap)).toBe(false);
    });

    it('returns false when no stepValuesMap', () => {
      expect(willBeSecret(secretStep, undefined)).toBe(false);
    });
  });

  it('exports HIDDEN_SECRET constant', () => {
    expect(HIDDEN_SECRET).toBe(HIDDEN_SECRET);
  });
});
