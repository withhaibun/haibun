import { describe, it, expect, vi } from 'vitest';
import { testWithWorld, getDefaultWorld } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';
import ConsoleMonitorStepper from './console-monitor-stepper.js';
import { Runner } from '../runner.js';
import { asFeatures } from '../lib/resolver-features.js';

describe('ConsoleMonitorStepper', () => {
  it('receives events via onEvent hook', async () => {
    const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'none' });
    const runner = new Runner(world);

    // Mock console.log to capture output
    const consoleLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      consoleLogs.push(args.join(' '));
    };

    try {
      const features = asFeatures([{
        path: '/features/test',
        content: 'set x to "hello"',
        base: 'test-base'
      }]);

      // Include the ConsoleMonitorStepper
      const res = await runner.runFeaturesAndBackgrounds(
        [VariablesStepper, Haibun, ConsoleMonitorStepper],
        { features, backgrounds: [] }
      );

      expect(res.ok).toBe(true);

      // Verify the monitor received events (it logs to console)
      // We should see at least one step completion
      const stepLogs = consoleLogs.filter(log => log.includes('✅') || log.includes('❌'));
      expect(stepLogs.length).toBeGreaterThan(0);

    } finally {
      // Restore console.log
      console.log = originalLog;
    }
  });

  it('handles verbose mode', async () => {
    const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'none' });
    world.moduleOptions = { ...world.moduleOptions, CONSOLE_MONITOR_VERBOSE: 'true' };
    const runner = new Runner(world);

    const consoleLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      consoleLogs.push(args.join(' '));
    };

    try {
      const features = asFeatures([{
        path: '/features/test',
        content: 'set y to "world"',
        base: 'test-base'
      }]);

      const res = await runner.runFeaturesAndBackgrounds(
        [VariablesStepper, Haibun, ConsoleMonitorStepper],
        { features, backgrounds: [] }
      );

      expect(res.ok).toBe(true);

    } finally {
      console.log = originalLog;
    }
  });
});
