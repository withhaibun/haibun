import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { StepperRegistry, StepMetadata } from '@haibun/core/lib/stepper-registry.js';
import { OK } from '@haibun/core/schema/protocol.js';

/**
 * LSP Integration Test - Tests that the StepperRegistry produces
 * valid LSP-compatible output that would work with a real language server.
 *
 * Tests the complete flow from stepper definition to LSP completion/hover data.
 */

class ProductionLikeStepper extends AStepper {
  steps = {
    navigateTo: {
      gwta: 'navigate to {url}',
      description: 'Navigate browser to URL',
      action: async () => OK,
    },
    clickElement: {
      gwta: 'click {selector}',
      description: 'Click an element',
      action: async () => OK,
    },
    setVariable: {
      gwta: 'set {name} to {value}',
      description: 'Set a variable value',
      action: async () => OK,
    },
    fillForm: {
      gwta: 'fill {field} with {text}',
      description: 'Fill form field with text',
      action: async () => OK,
    },
    waitSeconds: {
      gwta: 'wait {seconds: number} seconds',
      description: 'Wait for specified seconds',
      action: async () => OK,
    },
    privateStep: {
      gwta: 'internal cleanup',
      expose: false,
      action: async () => OK,
    },
  };
}

describe('LSP Integration - Completion Provider', () => {
  let metadata: StepMetadata[];

  beforeAll(() => {
    const steppers = [new ProductionLikeStepper()];
    metadata = StepperRegistry.getMetadata(steppers);
  });

  it('generates completion items for all exposed steps', () => {
    // Should have 5 exposed steps (not privateStep)
    expect(metadata.length).toBe(5);
  });

  it('completion items have valid LSP CompletionItem structure', () => {
    for (const step of metadata) {
      // Required fields for LSP CompletionItem
      expect(step.pattern).toBeDefined();
      expect(step.pattern.length).toBeGreaterThan(0);
      expect(step.stepperName).toBeDefined();
      expect(step.stepName).toBeDefined();
    }
  });

  describe('LSP snippet format', () => {
    it('converts patterns to valid LSP snippet syntax', () => {
      const navStep = metadata.find(m => m.stepName === 'navigateTo');
      const snippet = StepperRegistry.patternToSnippet(navStep!.pattern);

      // Valid LSP snippet: ${1:url}
      expect(snippet).toBe('navigate to ${1:url}');
    });

    it('handles multiple placeholders with sequential tab-stops', () => {
      const setStep = metadata.find(m => m.stepName === 'setVariable');
      const snippet = StepperRegistry.patternToSnippet(setStep!.pattern);

      expect(snippet).toBe('set ${1:name} to ${2:value}');
    });

    it('handles typed placeholders with domain annotation', () => {
      const waitStep = metadata.find(m => m.stepName === 'waitSeconds');
      const snippet = StepperRegistry.patternToSnippet(waitStep!.pattern);

      // Should strip domain annotation for snippet display
      expect(snippet).toBe('wait ${1:seconds} seconds');
    });

    it('snippet format is compatible with VS Code', () => {
      // VS Code expects: ${n:placeholder} or $n format
      const fillStep = metadata.find(m => m.stepName === 'fillForm');
      const snippet = StepperRegistry.patternToSnippet(fillStep!.pattern);

      // Regex for valid VS Code snippet placeholders
      const vsCodeSnippetPattern = /\$\{\d+:\w+\}/g;
      const matches = snippet.match(vsCodeSnippetPattern);
      expect(matches).toHaveLength(2);
    });
  });
});

describe('LSP Integration - Hover Provider', () => {
  let metadata: StepMetadata[];

  beforeAll(() => {
    const steppers = [new ProductionLikeStepper()];
    metadata = StepperRegistry.getMetadata(steppers);
  });

  it('provides parameter information for hover', () => {
    const setStep = metadata.find(m => m.stepName === 'setVariable');
    expect(setStep?.params).toEqual({
      name: 'string',
      value: 'string',
    });
  });

  it('detects number type parameters', () => {
    const waitStep = metadata.find(m => m.stepName === 'waitSeconds');
    expect(waitStep?.params.seconds).toBe('number');
  });

  it('hover content can be formatted as markdown', () => {
    const step = metadata.find(m => m.stepName === 'setVariable');

    // Generate markdown like LspStepper.onHover would
    const paramList = Object.entries(step!.params)
      .map(([name, type]) => `- **${name}**: \`${type}\``)
      .join('\n');

    const markdown = `### ${step!.stepperName}\n\`${step!.pattern}\`\n\n**Parameters:**\n${paramList}`;

    expect(markdown).toContain('### ProductionLikeStepper');
    expect(markdown).toContain('`set {name} to {value}`');
    expect(markdown).toContain('- **name**: `string`');
    expect(markdown).toContain('- **value**: `string`');
  });
});

describe('LSP Integration - Prefix Matching', () => {
  let metadata: StepMetadata[];

  beforeAll(() => {
    const steppers = [new ProductionLikeStepper()];
    metadata = StepperRegistry.getMetadata(steppers);
  });

  it('can find step by prefix match (for hover detection)', () => {
    const userLine = 'navigate to https://example.com';

    const match = metadata.find(m => {
      const prefix = m.pattern.split('{')[0].trim();
      return prefix.length > 0 && userLine.includes(prefix);
    });

    expect(match?.stepName).toBe('navigateTo');
  });

  it('can match partial input (for autocomplete trigger)', () => {
    const partialInput = 'set testVar';

    const matches = metadata.filter(m => {
      const cleanPattern = m.pattern.replace(/\{[^}]+\}/g, '');
      const firstWord = cleanPattern.trim().split(' ')[0];
      return partialInput.toLowerCase().startsWith(firstWord.toLowerCase());
    });

    expect(matches.some(m => m.stepName === 'setVariable')).toBe(true);
  });
});
