import { describe, it, expect, beforeEach } from 'vitest';
import { EventLogger, } from './EventLogger.js';
import { TFeatureStep } from './defs.js';
import { OBSCURED_VALUE } from './feature-variables.js';

const OK = { ok: true as const };

describe('EventLogger', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger();
    logger.suppressConsole = true;
  });

  describe('obscure secret values', () => {
    // Use 'as TFeatureStep' to bypass full type checking for test mock
    const mockFeatureStep = {
      source: { path: '/test/feature.ts', lineNumber: 1 },
      in: 'set password to "secret123"',
      seqPath: [1, 1, 1],
      action: {
        actionName: 'set',
        stepperName: 'VariablesStepper',
        step: {
          gwta: 'set {what} to {value}',
          action: async () => OK
        }
      }
    } as unknown as TFeatureStep;

    it('should obscure secret values in stepStart', () => {
      const emitted: unknown[] = [];
      logger.setStepperCallback((event) => emitted.push(event));

      const stepValuesMap = {
        password: { term: 'password', value: 'secret123', domain: 'string', origin: 'var' },
        username: { term: 'username', value: 'testuser', domain: 'string', origin: 'var' }
      };

      const isSecretFn = (name: string) => name === 'password';

      logger.stepStart(mockFeatureStep, 'VariablesStepper', 'set', {}, stepValuesMap, isSecretFn);

      expect(emitted.length).toBe(1);
      const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
      expect(event.stepValuesMap).toBeDefined();
      expect(event.stepValuesMap?.password.value).toBe(OBSCURED_VALUE);
      expect(event.stepValuesMap?.username.value).toBe('testuser');
    });

    it('should obscure secret values in stepEnd', () => {
      const emitted: unknown[] = [];
      logger.setStepperCallback((event) => emitted.push(event));

      const stepValuesMap = {
        apiKey: { term: 'apiKey', value: 'key-abc-123', domain: 'string', origin: 'var' },
        count: { term: 'count', value: '42', domain: 'string', origin: 'var' }
      };

      const isSecretFn = (name: string) => name === 'apiKey';

      logger.stepEnd(mockFeatureStep, 'VariablesStepper', 'set', true, undefined, {}, stepValuesMap, undefined, isSecretFn);

      expect(emitted.length).toBe(1);
      const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
      expect(event.stepValuesMap).toBeDefined();
      expect(event.stepValuesMap?.apiKey.value).toBe(OBSCURED_VALUE);
      expect(event.stepValuesMap?.count.value).toBe('42');
    });

    it('should not obscure when isSecretFn returns false for all', () => {
      const emitted: unknown[] = [];
      logger.setStepperCallback((event) => emitted.push(event));

      const stepValuesMap = {
        password: { term: 'password', value: 'secret123', domain: 'string', origin: 'var' }
      };

      const isSecretFn = () => false;
      logger.stepStart(mockFeatureStep, 'VariablesStepper', 'set', {}, stepValuesMap, isSecretFn);

      expect(emitted.length).toBe(1);
      const event = emitted[0] as { stepValuesMap?: Record<string, { value: unknown }> };
      expect(event.stepValuesMap?.password.value).toBe('secret123');
    });

    it('should handle null stepValuesMap', () => {
      const emitted: unknown[] = [];
      logger.setStepperCallback((event) => emitted.push(event));

      const isSecretFn = (name: string) => name === 'password';

      logger.stepStart(mockFeatureStep, 'VariablesStepper', 'set', {}, undefined, isSecretFn);

      expect(emitted.length).toBe(1);
      const event = emitted[0] as { stepValuesMap?: Record<string, unknown> };
      expect(event.stepValuesMap).toBeUndefined();
    });

    it('should handle primitive values in stepValuesMap', () => {
      const emitted: unknown[] = [];
      logger.setStepperCallback((event) => emitted.push(event));

      const stepValuesMap = {
        password: 'secret123',
        username: 'testuser'
      };

      const isSecretFn = (name: string) => name === 'password';

      logger.stepStart(mockFeatureStep, 'VariablesStepper', 'set', {}, stepValuesMap, isSecretFn);

      expect(emitted.length).toBe(1);
      const event = emitted[0] as { stepValuesMap?: Record<string, unknown> };
      expect(event.stepValuesMap?.password).toBe(OBSCURED_VALUE);
      expect(event.stepValuesMap?.username).toBe('testuser');
    });
  });
});
