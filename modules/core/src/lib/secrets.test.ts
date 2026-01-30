import { describe, it, expect } from 'vitest';
import { passWithDefaults } from './test/lib.js';
import VariablesStepper from '../steps/variables-stepper.js';
import { EventCollectorStepper } from './test/EventCollectorStepper.js';
import { TLifecycleEvent, TStepEvent, THaibunEvent } from '../schema/protocol.js';
import { HIDDEN_SECRET } from './sanitization.js';
import { willBeSecret, isSecretByName } from './set-modifiers.js';
import { EventLogger } from './EventLogger.js';
import { TFeatureStep, TStepValuesMap } from './defs.js';

describe('Secret Sanitization', () => {
  const SECRET_VAL = 'secret-val-1';

  describe('Detection Logic', () => {
    const secretStep = { handlesSecret: true };

    describe('isSecretByName', () => {
      it('detects password in name', () => {
        expect(isSecretByName('userPassword')).toBe(true);
        expect(isSecretByName('PASSWORD')).toBe(true);
        expect(isSecretByName('passwordField')).toBe(true);
      });

      it('returns false for non-secret names', () => {
        expect(isSecretByName('myVar')).toBe(false);
        expect(isSecretByName('apiKey')).toBe(false);
      });
    });

    describe('willBeSecret', () => {
      it('returns true for secret domain', () => {
        const stepValuesMap = { what: { term: 'apiKey' }, domain: { term: 'secret' } } as unknown as TStepValuesMap;
        expect(willBeSecret(secretStep as any, stepValuesMap)).toBe(true);
      });

      it('returns true for password in variable name', () => {
        const stepValuesMap = { what: { term: 'userPassword' } } as unknown as TStepValuesMap;
        expect(willBeSecret(secretStep as any, stepValuesMap)).toBe(true);
      });

      it('returns false without handlesSecret flag', () => {
        const stepValuesMap = { what: { term: 'userPassword' }, domain: { term: 'secret' } } as unknown as TStepValuesMap;
        expect(willBeSecret({} as any, stepValuesMap)).toBe(false);
      });

      it('returns false for non-secret', () => {
        const stepValuesMap = { what: { term: 'myVar' }, domain: { term: 'string' } } as unknown as TStepValuesMap;
        expect(willBeSecret(secretStep as any, stepValuesMap)).toBe(false);
      });
    });

    describe('EventLogger (Low-level Sanitization)', () => {
      it('sanitizes set userPassword in stepStart', () => {
        const logger = new EventLogger();
        const emitted: THaibunEvent[] = [];
        logger.setStepperCallback(e => emitted.push(e));

        const stepIn = 'set userPassword to "my-secret-password"';
        const featureStep = {
          in: stepIn,
          seqPath: [1, 1, 1],
          source: { path: '/test/feature.ts', lineNumber: 1 },
          action: {
            step: { handlesSecret: true },
            stepValuesMap: {
              what: { term: 'userPassword', value: 'userPassword' },
              value: { term: 'my-secret-password', value: 'my-secret-password' }
            }
          }
        } as unknown as TFeatureStep;

        logger.stepStart(featureStep, 'VariablesStepper', 'set', { what: 'userPassword', value: 'my-secret-password' }, featureStep.action.stepValuesMap);

        const event = emitted.find(e => (e as TLifecycleEvent).stage === 'start') as TLifecycleEvent;
        expect(event).toBeDefined();

        if (event.kind === 'lifecycle' && event.type === 'step') {
          expect(event.in).toContain(HIDDEN_SECRET);
          expect(event.in).not.toContain('my-secret-password');
          const stepArgs = event.stepArgs as Record<string, unknown>;
          expect(stepArgs?.value).toBe(HIDDEN_SECRET);
        } else {
          throw new Error('Expected step lifecycle event');
        }
      });

      it('redacts secrets from previous steps in subsequent failing steps (persistent leak prevention)', () => {
        const logger = new EventLogger();
        const emitted: THaibunEvent[] = [];
        logger.setStepperCallback(e => emitted.push(e));

        // Step 1: Set the secret
        const step1In = 'set apiKey as secret to "super-secret-token"';
        const featureStep1 = {
          in: step1In,
          seqPath: [1, 1],
          source: { path: 'test.feature', lineNumber: 1 },
          action: {
            step: { handlesSecret: true },
            stepValuesMap: {
              what: { term: 'apiKey', value: 'apiKey' },
              domain: { term: 'secret', value: 'secret' },
              value: { term: 'super-secret-token', value: 'super-secret-token' }
            }
          }
        } as unknown as TFeatureStep;

        logger.stepStart(featureStep1, 'VariablesStepper', 'setAs', {}, featureStep1.action.stepValuesMap);
        logger.stepEnd(featureStep1, 'VariablesStepper', 'setAs', true, undefined, {}, featureStep1.action.stepValuesMap);

        // Step 2: Step that FAILS and includes the secret.
        const knownSecrets = ['super-secret-token'];
        const step2In = 'not see "super-secret-token"';
        const errorMessage = 'expected not to see "super-secret-token"';

        const featureStep2 = {
          in: step2In,
          seqPath: [1, 2],
          source: { path: 'test.feature', lineNumber: 2 },
          action: { step: {}, stepValuesMap: {} }
        } as unknown as TFeatureStep;

        logger.stepStart(featureStep2, 'WebStepper', 'see', {}, {}, undefined, undefined, knownSecrets);
        logger.stepEnd(featureStep2, 'WebStepper', 'see', false, errorMessage, {}, {}, undefined, undefined, undefined, knownSecrets);

        const step2Start = emitted.find(e => e.id === '[1.2]' && (e as TLifecycleEvent).stage === 'start') as TStepEvent;
        const step2End = emitted.find(e => e.id === '[1.2]' && (e as TLifecycleEvent).stage === 'end') as TStepEvent;

        expect(step2Start).toBeDefined();
        expect(step2End).toBeDefined();
        expect(step2Start.in).toContain(HIDDEN_SECRET);
        expect(step2Start.in).not.toContain('super-secret-token');
        expect(step2End.error).toContain(HIDDEN_SECRET);
        expect(step2End.error).not.toContain('super-secret-token');
      });
    });
  });

  describe('Functional Tests', () => {
    it('obscures variables with "password" in name and explicit secrets', async () => {
      const content = `
          set userPassword to "${SECRET_VAL}"
          set apiKey as secret to "api-key-value"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      collector.assertNoSecrets([SECRET_VAL, 'api-key-value']);
      expect(collector.containsValue(HIDDEN_SECRET)).toBe(true);
    });

    it('inherits secret status through compose', async () => {
      const content = `
          set mySecret as secret to "${SECRET_VAL}"
          compose derived with prefix-{mySecret}-suffix
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      // The composed value should not leak in events
      collector.assertNoSecrets([SECRET_VAL]);
      
      // The derived variable should be marked as secret
      expect(res.world?.shared.isSecret('derived')).toBe(true);
    });

    it('inherits secret status through compose with multiple secrets', async () => {
      const content = `
          set user to "admin"
          set myPassword as secret to "${SECRET_VAL}"
          compose creds with {user}:{myPassword}
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      
      // Non-secret source doesn't make result secret
      expect(res.world?.shared.isSecret('user')).toBe(false);
      // The creds variable should be secret because it contains a secret
      expect(res.world?.shared.isSecret('creds')).toBe(true);
    });

    it('obscures embedded secrets in arguments', async () => {
      const content = `
        set myHidden as secret to "${SECRET_VAL}"
        matches "foo" with "bar {myHidden}"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      const events = collector.getEvents();
      const secretsFound = events.some(e => JSON.stringify(e).includes(SECRET_VAL));
      const obscuredFound = events.some(e => JSON.stringify(e).includes(HIDDEN_SECRET));

      expect(secretsFound).toBe(false);
      expect(obscuredFound).toBe(true);
    });

    it('obscures secrets in error messages', async () => {
      const content = `
        set mySecret as secret to "${SECRET_VAL}"
        variable mySecret is "DIFFERENT_VALUE"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      const events = collector.getEvents();
      const secretsFound = events.some(e => JSON.stringify(e).includes(SECRET_VAL));
      const obscuredFound = events.some(e => JSON.stringify(e).includes(HIDDEN_SECRET));

      expect(secretsFound).toBe(false);
      expect(obscuredFound, 'Expected to find obscured value in error message').toBe(true);
    });

    it('obscures secrets in executor results (stepResult.in)', async () => {
      const content = `set mySecret as secret to "${SECRET_VAL}"`;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);

      let foundSecret = false;
      let foundObscured = false;

      if (res.featureResults) {
        for (const featureResult of res.featureResults) {
          for (const stepResult of featureResult.stepResults) {
            if (stepResult.in.includes(SECRET_VAL)) foundSecret = true;
            if (stepResult.in.includes(HIDDEN_SECRET)) foundObscured = true;
          }
        }
      }

      expect(foundSecret).toBe(false);
      expect(foundObscured).toBe(true);

      const failingContent = `
        set mySecret as secret to "${SECRET_VAL}"
        variable mySecret is "WRONG"
      `;
      const resFail = await passWithDefaults(failingContent, [VariablesStepper, EventCollectorStepper]);

      let failureLeak = false;
      resFail.featureResults?.forEach(fr => {
        fr.stepResults.forEach(sr => {
          if (sr.ok === false && JSON.stringify(sr).includes(SECRET_VAL)) {
            failureLeak = true;
          }
        });
      });
      expect(failureLeak, 'Secret leaked in failure message').toBe(false);
    });

    it('detects persistent secret leaks in start/end events', async () => {
      const content = `
        set apiKey as secret to "${SECRET_VAL}"
        variable apiKey is "WRONG_VALUE" 
      `;

      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      collector.assertNoSecrets([SECRET_VAL]);

      const events = collector.getEvents();
      const secondStepEvents = events.filter(e =>
        e.kind === 'lifecycle' &&
        e.type === 'step' &&
        (e as TStepEvent).in?.includes('variable apiKey is')
      );

      for (const e of secondStepEvents) {
        const serialized = JSON.stringify(e);
        if (serialized.includes(SECRET_VAL)) {
          throw new Error(`Leaked secret in second step event: ${serialized}`);
        }
      }
    });
  });
});
