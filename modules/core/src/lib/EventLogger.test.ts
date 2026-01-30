import { describe, it, expect } from 'vitest';
import { passWithDefaults } from './test/lib.js';
import VariablesStepper from '../steps/variables-stepper.js';
import { EventCollectorStepper } from './test/EventCollectorStepper.js';
import { TStepEvent } from '../schema/protocol.js';
import { HIDDEN_SECRET } from './set-modifiers.js';

describe('EventLogger', () => {
  describe('obscure secret values', () => {
    it('should obscure values at stepStart when step sets a secret (via name pattern)', async () => {
      const content = `
        set userPassword to "secret123"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      collector.assertNoSecrets(['secret123']);
      expect(collector.containsValue(HIDDEN_SECRET)).toBe(true);

      const stepStartEvent = collector.getEvents({ kind: 'lifecycle', type: 'step', stage: 'start', in: 'userPassword' })[0] as TStepEvent;

      expect(stepStartEvent).toBeDefined();
      expect(stepStartEvent.in).toContain(HIDDEN_SECRET);
      expect(stepStartEvent.in).not.toContain('secret123');
    });

    it('should obscure values at stepStart when step has explicit secret modifier', async () => {
      const content = `
        set apiKey as secret to "abc123"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      collector.assertNoSecrets(['abc123']);
      expect(collector.containsValue(HIDDEN_SECRET)).toBe(true);

      const stepStartEvent = collector.getEvents({ kind: 'lifecycle', type: 'step', stage: 'start', in: 'apiKey' })[0] as TStepEvent;

      expect(stepStartEvent).toBeDefined();
      expect(stepStartEvent.in).toContain(HIDDEN_SECRET);
      expect(stepStartEvent.in).not.toContain('abc123');
    });

    it('should NOT obscure values at stepStart when step is not setting a secret', async () => {
      const content = `
        set count to "42"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      const stepStartEvent = collector.getEvents({ kind: 'lifecycle', type: 'step', stage: 'start', in: 'count' })[0] as TStepEvent;

      expect(stepStartEvent).toBeDefined();
      expect(stepStartEvent.in).toContain('42');
      expect(stepStartEvent.in).not.toContain(HIDDEN_SECRET);
    });

    it('should obscure secret values in stepEnd (selective)', async () => {
      const content = `
        set apiKey as secret to "key-abc-123"
        set count to "42"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      collector.assertNoSecrets(['key-abc-123']);
      const stepEndEvent = collector.getEvents({ kind: 'lifecycle', type: 'step', stage: 'end', in: 'apiKey' })[0] as TStepEvent;

      expect(stepEndEvent).toBeDefined();
      // Verify the secret is obscured in the event
      const eventJson = JSON.stringify(stepEndEvent);
      expect(eventJson).not.toContain('key-abc-123');
      expect(eventJson).toContain(HIDDEN_SECRET);
    });

    it('should not obscure non-secret values in stepEnd', async () => {
      const content = `
        set myVar to "visible-value"
        variable myVar is "visible-value"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      expect(collector.containsValue('visible-value')).toBe(true);
    });

    it('should handle null stepValuesMap gracefully', async () => {
      const content = `
        set value to "test"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;

      expect(collector.getEvents().length).toBeGreaterThan(0);
      // Should not throw and should handle undefined stepValuesMap
      expect(res.ok).toBe(true);
    });

    it('should obscure secret value in field when step sets secret', async () => {
      const content = `
        set userPassword to "mysecretvalue"
      `;
      const res = await passWithDefaults(content, [VariablesStepper, EventCollectorStepper]);
      
      expect(res.ok).toBe(true);
      const collector = res.steppers?.find(s => s instanceof EventCollectorStepper) as EventCollectorStepper;
      const stepStartEvent = collector.getEvents({ kind: 'lifecycle', type: 'step', stage: 'start', in: 'userPassword' })[0] as TStepEvent;

      expect(stepStartEvent).toBeDefined();
      // The in field should have the HIDDEN_SECRET because userPassword is a secret variable (contains "password")
      expect(stepStartEvent.in).toContain(HIDDEN_SECRET);
    });
  });
});
