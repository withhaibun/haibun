/**
 * Integration tests for MonitorOtelStepper against local Docker stack.
 * 
 * Prerequisites:
 *   cd modules/monitor-otel && docker-compose up -d
 * 
 * Run:
 *   npm run test:integration
 * 
 * These tests verify:
 * 1. OTel collector is reachable
 * 2. Spans can be created and flushed without errors
 * 3. The stepper correctly initializes with the OTel SDK
 */

import { describe, it, expect, beforeAll } from 'vitest';
import MonitorOtelStepper from './index.js';
import { THaibunEvent } from '@haibun/core/monitor/index.js';

const OTEL_ENDPOINT = 'http://localhost:4318';
const JAEGER_API = 'http://localhost:16686/api';

// Check if Docker stack is running
async function isOtelCollectorRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OTEL_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] })
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

// Check if Jaeger is running
async function isJaegerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${JAEGER_API}/services`);
    return response.ok;
  } catch {
    return false;
  }
}

describe('MonitorOtelStepper Integration', () => {
  let collectorRunning = false;
  let jaegerRunning = false;

  beforeAll(async () => {
    collectorRunning = await isOtelCollectorRunning();
    jaegerRunning = await isJaegerRunning();
    if (!collectorRunning) {
      console.warn('⚠️  OTel Collector not running. Run: cd modules/monitor-otel && docker-compose up -d');
    }
    if (!jaegerRunning) {
      console.warn('⚠️  Jaeger not running');
    }
  });

  it('should verify OTel collector is reachable', async () => {
    if (!collectorRunning) {
      console.log('Skipping: OTel Collector not running');
      return;
    }

    // Verify we can POST to the traces endpoint
    const response = await fetch(`${OTEL_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] })
    });

    expect(response.ok || response.status === 400).toBe(true);
  });

  it('should verify Jaeger UI is reachable', async () => {
    if (!jaegerRunning) {
      console.log('Skipping: Jaeger not running');
      return;
    }

    const response = await fetch(`${JAEGER_API}/services`);
    const data = await response.json();

    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('should initialize stepper without errors', async () => {
    if (!collectorRunning) {
      console.log('Skipping: OTel Collector not running');
      return;
    }

    const mockWorld = {
      logger: {
        info: () => { },
        debug: () => { },
        warn: console.warn,
        error: console.error,
      },
      moduleOptions: {
        'MonitorOtelStepper': {
          OTEL_ENDPOINT,
          SERVICE_NAME: 'haibun-test'
        }
      },
      eventLogger: {
        setStepperCallback: () => { }
      }
    };

    const stepper = new MonitorOtelStepper();
    await stepper.setWorld(mockWorld as any, []);

    expect(stepper).toBeDefined();
    expect(stepper.options).toHaveProperty('OTEL_ENDPOINT');
    expect(stepper.cycles).toHaveProperty('onEvent');
    expect(stepper.cycles).toHaveProperty('endFeature');
    expect(stepper.cycles).toHaveProperty('endExecution');
  });

  it('should process lifecycle events without throwing', async () => {
    if (!collectorRunning) {
      console.log('Skipping: OTel Collector not running');
      return;
    }

    const mockWorld = {
      logger: { info: () => { }, debug: () => { }, warn: () => { }, error: console.error },
      moduleOptions: {
        'MonitorOtelStepper': {
          OTEL_ENDPOINT,
          SERVICE_NAME: `haibun-test-${Date.now()}`
        }
      },
      eventLogger: {
        setStepperCallback: () => { }
      }
    };

    const stepper = new MonitorOtelStepper();
    await stepper.setWorld(mockWorld as any, []);

    // Simulate step start
    const stepStartEvent: THaibunEvent = {
      id: 'test-step-1',
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'lifecycle',
      type: 'step',
      stage: 'start',
      label: 'test step passes',
      status: 'running',
      stepperName: 'TestStepper',
      actionName: 'testAction'
    };

    // Initialize OTel
    await stepper.cycles.startExecution!({} as any);

    // These should not throw
    await stepper.cycles.onEvent!(stepStartEvent);

    // Simulate step end
    const stepEndEvent: THaibunEvent = {
      id: 'test-step-1',
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'lifecycle',
      type: 'step',
      stage: 'end',
      label: 'test step passes',
      status: 'completed',
      stepperName: 'TestStepper',
      actionName: 'testAction'
    };

    await stepper.cycles.onEvent!(stepEndEvent);
    await stepper.cycles.endFeature!();
    await stepper.cycles.endExecution!();

    // If we get here without throwing, test passes
    expect(true).toBe(true);
  });
});
