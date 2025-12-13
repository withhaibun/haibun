import { describe, it, expect } from 'vitest';
import { messageContextToEvent, isLifecycleContext, isControlContext } from './event-bridge.js';
import { EExecutionMessageType, TMessageContext } from './interfaces/logger.js';

describe('event-bridge', () => {
  describe('messageContextToEvent', () => {
    it('converts simple log message to LogEvent', () => {
      const event = messageContextToEvent('test message', 'info');

      expect(event).not.toBeNull();
      expect(event?.kind).toBe('log');
      expect(event?.kind === 'log' && event.level).toBe('info');
      expect(event?.kind === 'log' && event.message).toBe('test message');
    });

    it('converts STEP_START to LifecycleEvent', () => {
      const context: TMessageContext = {
        incident: EExecutionMessageType.STEP_START,
        incidentDetails: { stepperName: 'TestStepper', actionName: 'testAction' }
      };

      const event = messageContextToEvent('running step', 'log', context, '1.1.1');

      expect(event).not.toBeNull();
      expect(event?.kind).toBe('lifecycle');
      if (event?.kind === 'lifecycle') {
        expect(event.type).toBe('step');
        expect(event.stage).toBe('start');
        expect(event.status).toBe('running');
        expect(event.stepperName).toBe('TestStepper');
        expect(event.actionName).toBe('testAction');
      }
    });

    it('converts STEP_END to LifecycleEvent', () => {
      const context: TMessageContext = {
        incident: EExecutionMessageType.STEP_END,
        incidentDetails: { ok: true }
      };

      const event = messageContextToEvent('step completed', 'log', context);

      expect(event).not.toBeNull();
      expect(event?.kind).toBe('lifecycle');
      if (event?.kind === 'lifecycle') {
        expect(event.type).toBe('step');
        expect(event.stage).toBe('end');
        expect(event.status).toBe('completed');
      }
    });

    it('converts FEATURE_START to LifecycleEvent', () => {
      const context: TMessageContext = {
        incident: EExecutionMessageType.FEATURE_START,
      };

      const event = messageContextToEvent('Feature: Login', 'log', context);

      expect(event?.kind).toBe('lifecycle');
      if (event?.kind === 'lifecycle') {
        expect(event.type).toBe('feature');
        expect(event.stage).toBe('start');
        expect(event.label).toBe('Feature: Login');
      }
    });

    it('converts DEBUG to ControlEvent', () => {
      const context: TMessageContext = {
        incident: EExecutionMessageType.DEBUG,
        incidentDetails: { rerunStep: true }
      };

      const event = messageContextToEvent('debug', 'debug', context);

      expect(event?.kind).toBe('control');
      if (event?.kind === 'control') {
        expect(event.signal).toBe('break');
      }
    });

    it('converts GRAPH_LINK to ControlEvent', () => {
      const context: TMessageContext = {
        incident: EExecutionMessageType.GRAPH_LINK,
        incidentDetails: { target: 'someNode' }
      };

      const event = messageContextToEvent('link', 'log', context);

      expect(event?.kind).toBe('control');
      if (event?.kind === 'control') {
        expect(event.signal).toBe('graph-link');
      }
    });
  });

  describe('isLifecycleContext', () => {
    it('returns true for lifecycle incidents', () => {
      expect(isLifecycleContext({ incident: EExecutionMessageType.STEP_START })).toBe(true);
      expect(isLifecycleContext({ incident: EExecutionMessageType.FEATURE_END })).toBe(true);
    });

    it('returns false for non-lifecycle incidents', () => {
      expect(isLifecycleContext({ incident: EExecutionMessageType.DEBUG })).toBe(false);
      expect(isLifecycleContext({ incident: EExecutionMessageType.ACTION })).toBe(false);
      expect(isLifecycleContext()).toBe(false);
    });
  });

  describe('isControlContext', () => {
    it('returns true for control incidents', () => {
      expect(isControlContext({ incident: EExecutionMessageType.DEBUG })).toBe(true);
      expect(isControlContext({ incident: EExecutionMessageType.GRAPH_LINK })).toBe(true);
    });

    it('returns false for non-control incidents', () => {
      expect(isControlContext({ incident: EExecutionMessageType.STEP_START })).toBe(false);
      expect(isControlContext()).toBe(false);
    });
  });
});
