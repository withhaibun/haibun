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

  describe('that ... matches (predicate)', () => {
    // Glob pattern matching: that {value} matches {pattern}
    // Uses * as wildcard for any characters

    it('passes with glob pattern', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          that "https://test.com/login" matches "https://test.com/*"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when value does not match pattern', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          not that "https://other.com/page" matches "https://test.com/*"
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
          
          every u in urls is that {u} matches "https://test.com/*"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails when some members do not match pattern', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://other.com/page"
          
          not every u in urls is that {u} matches "https://test.com/*"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });

  describe('nested quantifier composition (every + some)', () => {
    // Proper composition: ∀ page ∈ urls: ∃ pattern ∈ Allowed: page.matches(pattern)
    // Uses orthogonal building blocks: every, some, matches

    it('passes: every page matches some allowed pattern', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://staging.com/dashboard"
          
          set of Allowed patterns is ["https://test.com/*" "https://staging.com/*"]
          
          every page in urls is some pattern in Allowed patterns is that {page} matches {pattern}
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('fails: page does not match any allowed pattern', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          set of urls as [string]
          set url1 as urls to "https://test.com/login"
          set url2 as urls to "https://unknown.com/page"
          
          set of Allowed patterns is ["https://test.com/*" "https://staging.com/*"]
          
          not every page in urls is some pattern in Allowed patterns is that {page} matches {pattern}
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });

    it('uses simple two-arg matches predicate', async () => {
      const feature = {
        path: '/features/test.feature',
        content: `
          that "https://test.com/login" matches "https://test.com/*"
        `
      };
      const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
      expect(result.ok).toBe(true);
    });
  });
});
