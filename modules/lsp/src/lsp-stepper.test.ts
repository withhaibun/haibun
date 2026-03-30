import { describe, it, expect } from 'vitest';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { StepperRegistry } from '@haibun/core/lib/stepper-registry.js';
import { OK } from '@haibun/core/schema/protocol.js';

// Note: Full LSP integration tests require a mock connection.
// These tests focus on the StepperRegistry integration that LSP uses.

class SampleStepper extends AStepper {
  steps = {
    navigateTo: {
      gwta: 'navigate to {url}',
      action: async () => OK,
    },
    setVariable: {
      gwta: 'set {name} to {value}',
      action: async () => OK,
    },
    clickButton: {
      exact: 'click the submit button',
      action: async () => OK,
    },
    hiddenStep: {
      gwta: 'internal action',
      exposeMCP: false,
      action: async () => OK,
    },
  };
}

describe('LSP StepperRegistry Integration', () => {
  const steppers = [new SampleStepper()];

  describe('metadata for LSP autocomplete', () => {
    const metadata = StepperRegistry.getMetadata(steppers);

    it('provides step patterns for completion labels', () => {
      const labels = metadata.map(m => m.pattern);
      expect(labels).toContain('navigate to {url}');
      expect(labels).toContain('set {name} to {value}');
      expect(labels).toContain('click the submit button');
    });

    it('excludes hidden steps from autocomplete', () => {
      const labels = metadata.map(m => m.pattern);
      expect(labels).not.toContain('internal action');
    });

    it('provides stepper names for detail display', () => {
      const step = metadata.find(m => m.stepName === 'navigateTo');
      expect(step?.stepperName).toBe('SampleStepper');
    });
  });

  describe('snippet generation for tab-stops', () => {
    it('converts gwta patterns to LSP snippets', () => {
      const snippet = StepperRegistry.patternToSnippet('navigate to {url}');
      expect(snippet).toBe('navigate to ${1:url}');
    });

    it('numbers multiple placeholders sequentially', () => {
      const snippet = StepperRegistry.patternToSnippet('set {name} to {value}');
      expect(snippet).toBe('set ${1:name} to ${2:value}');
    });

    it('leaves exact patterns unchanged', () => {
      const snippet = StepperRegistry.patternToSnippet('click the submit button');
      expect(snippet).toBe('click the submit button');
    });
  });

  describe('hover documentation', () => {
    const metadata = StepperRegistry.getMetadata(steppers);

    it('provides parameter info for hover', () => {
      const step = metadata.find(m => m.stepName === 'setVariable');
      expect(step?.params).toEqual({ name: 'string', value: 'string' });
    });

    it('provides empty params for exact steps', () => {
      const step = metadata.find(m => m.stepName === 'clickButton');
      expect(step?.params).toEqual({});
    });
  });
});
