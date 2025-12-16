import { describe, it, expect } from 'vitest';
import MonitorOtelStepper from './index.js';

describe('MonitorOtelStepper', () => {
  it('should have required options', () => {
    const stepper = new MonitorOtelStepper();
    expect(stepper.options).toHaveProperty('OTEL_ENDPOINT');
    expect(stepper.options).toHaveProperty('SERVICE_NAME');
  });

  it('should have cycles for event handling', () => {
    const stepper = new MonitorOtelStepper();
    expect(stepper.cycles).toHaveProperty('startExecution');
    expect(stepper.cycles).toHaveProperty('onEvent');
    expect(stepper.cycles).toHaveProperty('endFeature');
    expect(stepper.cycles).toHaveProperty('endExecution');
  });

  it('should have custom span steps', () => {
    const stepper = new MonitorOtelStepper();
    expect(stepper.steps).toHaveProperty('startSpan');
    expect(stepper.steps).toHaveProperty('endSpan');
  });
});
