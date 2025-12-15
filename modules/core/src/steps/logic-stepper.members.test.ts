import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import LogicStepper from './logic-stepper.js';
import VariablesStepper from './variables-stepper.js';

describe('every/some with member values', () => {
  describe('every iterates over member values when domain has no enum values', () => {
    it('passes when all members satisfy condition', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://example.com"
          set url2 as urls to "https://example.org"
          
          set of known is ["https://example.com" "https://example.org" "https://example.net"]
          
          every u in urls is {u} is in known
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when a member does not satisfy condition', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://example.com"
          set url2 as urls to "https://unknown.com"
          
          set of known is ["https://example.com" "https://example.org"]
          
          not every u in urls is {u} is in known
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('vacuously true when domain has no members', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          
          set of known is ["https://example.com"]
          
          every u in urls is {u} is in known
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });

  describe('some iterates over member values when domain has no enum values', () => {
    it('passes when at least one member satisfies condition', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://unknown.com"
          set url2 as urls to "https://example.com"
          
          set of known is ["https://example.com"]
          
          some u in urls is {u} is in known
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when no members satisfy condition', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://unknown1.com"
          set url2 as urls to "https://unknown2.com"
          
          set of known is ["https://example.com"]
          
          not some u in urls is {u} is in known
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });

  describe('is in step', () => {
    it('passes when value is in enum domain', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of colors is ["red" "green" "blue"]
          "red" is in colors
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when value is not in enum domain', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of colors is ["red" "green" "blue"]
          not "yellow" is in colors
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('passes when value is in member values', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://example.com"
          "https://example.com" is in urls
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });

  describe('that ... starts with (predicate)', () => {
    // Unambiguous syntax: that {value} starts with {prefix}
    // Starts with literal 'that' to avoid parsing conflicts with quantifiers

    it('passes with literal prefix', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          that "https://test.com/login" starts with "https://test.com/"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when value does not start with prefix', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          not that "https://other.com/page" starts with "https://test.com/"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('works with every quantifier and member values', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://test.com/dashboard"
          
          every u in urls is that {u} starts with "https://test.com/"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when some members do not start with prefix', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://other.com/page"
          
          not every u in urls is that {u} starts with "https://test.com/"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });

  describe('nested quantifier composition (every + some)', () => {
    // Proper composition: ∀ page ∈ urls: ∃ prefix ∈ Allowed: page.startsWith(prefix)
    // Uses orthogonal building blocks: every, some, starts with

    it('passes: every page starts with some allowed prefix', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://staging.com/dashboard"
          
          set of Allowed prefixes is ["https://test.com/" "https://staging.com/"]
          
          every page in urls is some prefix in Allowed prefixes is that {page} starts with {prefix}
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails: page does not match any allowed prefix', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://unknown.com/page"
          
          set of Allowed prefixes is ["https://test.com/" "https://staging.com/"]
          
          not every page in urls is some prefix in Allowed prefixes is that {page} starts with {prefix}
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('uses simple two-arg starts with predicate', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          that "https://test.com/login" starts with "https://test.com/"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });
});
