import { describe, it, expect } from 'vitest';
import { StepperRegistry, StepDescriptor } from './stepper-registry.js';
import { AStepper } from './astepper.js';
import { OK } from '../schema/protocol.js';

/**
 * Integration test verifying that StepperRegistry produces metadata
 * that matches what MCP clients expect from tools.
 *
 * These tests validate the contract between StepperRegistry and MCP
 * without requiring a running MCP server.
 */

class IntegrationTestStepper extends AStepper {
  steps = {
    setTestVar: {
      gwta: 'set {name} to {value}',
      action: async () => OK,
    },
    navigateTo: {
      gwta: 'navigate to {url}',
      action: async () => OK,
    },
    withNumberParam: {
      gwta: 'wait {seconds: number} seconds',
      action: async () => OK,
    },
    hiddenAction: {
      gwta: 'hidden step',
      exposeMCP: false,
      action: async () => OK,
    },
  };
}

describe('StepperRegistry Integration', () => {
  describe('metadata format matches MCP tool schema expectations', () => {
    const steppers = [new IntegrationTestStepper()];
    const metadata = StepperRegistry.getMetadata(steppers);

    it('produces tool-name compatible format: StepperName-stepName', () => {
      const step = metadata.find(m => m.stepName === 'setTestVar');
      if (!step) throw new Error('step not found');
      const toolName = `${step.stepperName}-${step.stepName}`;
      expect(toolName).toBe('IntegrationTestStepper-setTestVar');
    });

    it('extracts all parameters for tool schema', () => {
      const step = metadata.find(m => m.stepName === 'setTestVar');
      if (!step) throw new Error('step not found');
      expect(Object.keys(step.params)).toHaveLength(2);
      expect(step.params.name).toBe('string');
      expect(step.params.value).toBe('string');
    });

    it('pattern is usable as tool description', () => {
      const step = metadata.find(m => m.stepName === 'setTestVar');
      if (!step) throw new Error('step not found');
      expect(step.pattern).toBe('set {name} to {value}');
    });

    it('excludes hidden steps from tool registration', () => {
      const hidden = metadata.find(m => m.stepName === 'hiddenAction');
      expect(hidden).toBeUndefined();
    });

    it('detects number type from domain annotation', () => {
      const step = metadata.find(m => m.stepName === 'withNumberParam');
      if (!step) throw new Error('step not found');
      expect(step.params.seconds).toBe('number');
    });
  });

  describe('snippet format is valid LSP', () => {
    it('produces valid LSP snippet syntax', () => {
      const snippet = StepperRegistry.patternToSnippet('set {name} to {value}');
      // LSP snippets use ${n:placeholder} format
      expect(snippet).toMatch(/\$\{1:name\}/);
      expect(snippet).toMatch(/\$\{2:value\}/);
    });

    it('increments tab-stop numbers correctly', () => {
      const snippet = StepperRegistry.patternToSnippet('from {a} via {b} to {c}');
      expect(snippet).toBe('from ${1:a} via ${2:b} to ${3:c}');
    });
  });

  describe('tool schema compatibility', () => {
    const steppers = [new IntegrationTestStepper()];
    const metadata = StepperRegistry.getMetadata(steppers);

    it('metadata can be used to build tool definitions', () => {
      // Simulate how mcp-stepper.ts uses metadata to create tools
      for (const step of metadata) {
        const toolName = `${step.stepperName}-${step.stepName}`;
        const toolDescription = step.pattern;
        const toolParams = step.params;

        // These are the fields MCP needs
        expect(toolName).toMatch(/^\w+-\w+$/);
        expect(toolDescription).toBeDefined();
        expect(typeof toolParams).toBe('object');
      }
    });

    it('all params have valid type declarations', () => {
      for (const step of metadata) {
        for (const [paramName, paramType] of Object.entries(step.params)) {
          expect(['string', 'number']).toContain(paramType);
          expect(paramName).toBeTruthy();
        }
      }
    });
  });
});
