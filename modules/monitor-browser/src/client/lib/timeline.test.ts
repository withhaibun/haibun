import { describe, it, expect } from 'vitest';
import {
  calculateTimelineBounds,
  isEventInFuture,
  getEventRelativeTime,
  formatRelativeTime,
  isFutureEvent,
  HIGHLIGHT_COLOUR,
  DIMMED_COLOUR,
  DIMMED_OPACITY,
  FUTURE_EVENT_CLASS,
} from './timeline';
import { THaibunEvent } from '@haibun/core/schema/protocol.js';

describe('Timeline', () => {
  describe('calculateTimelineBounds', () => {
    it('throws on empty events array', () => {
      expect(() => calculateTimelineBounds([])).toThrow('events array is empty');
    });

    it('throws when no events have timestamps', () => {
      const events = [
        { id: '1', kind: 'log' } as unknown as THaibunEvent,
        { id: '2', kind: 'log' } as unknown as THaibunEvent,
      ];
      expect(() => calculateTimelineBounds(events)).toThrow('no events have valid timestamps');
    });

    it('calculates bounds from events in order', () => {
      const events: THaibunEvent[] = [
        { id: '1', kind: 'log', timestamp: 1000, level: 'info', message: 'first' } as THaibunEvent,
        { id: '2', kind: 'log', timestamp: 2000, level: 'info', message: 'middle' } as THaibunEvent,
        { id: '3', kind: 'log', timestamp: 3000, level: 'info', message: 'last' } as THaibunEvent,
      ];
      const result = calculateTimelineBounds(events);
      expect(result.minTimestamp).toBe(1000);
      expect(result.maxTimestamp).toBe(3000);
      expect(result.duration).toBe(2000);
    });

    it('calculates bounds from events out of order', () => {
      const events: THaibunEvent[] = [
        { id: '1', kind: 'log', timestamp: 3000, level: 'info', message: 'third' } as THaibunEvent,
        { id: '2', kind: 'log', timestamp: 1000, level: 'info', message: 'first' } as THaibunEvent,
        { id: '3', kind: 'log', timestamp: 2000, level: 'info', message: 'second' } as THaibunEvent,
      ];
      const result = calculateTimelineBounds(events);
      expect(result.minTimestamp).toBe(1000);
      expect(result.maxTimestamp).toBe(3000);
      expect(result.duration).toBe(2000);
    });

    it('handles single event', () => {
      const events: THaibunEvent[] = [
        { id: '1', kind: 'log', timestamp: 5000, level: 'info', message: 'only' } as THaibunEvent,
      ];
      const result = calculateTimelineBounds(events);
      expect(result.minTimestamp).toBe(5000);
      expect(result.maxTimestamp).toBe(5000);
      expect(result.duration).toBe(0);
    });

    it('ignores events without timestamps', () => {
      const events: THaibunEvent[] = [
        { id: '1', kind: 'log', timestamp: 1000, level: 'info', message: 'has timestamp' } as THaibunEvent,
        { id: '2', kind: 'log', level: 'info', message: 'no timestamp' } as unknown as THaibunEvent,
        { id: '3', kind: 'log', timestamp: 3000, level: 'info', message: 'has timestamp' } as THaibunEvent,
      ];
      const result = calculateTimelineBounds(events);
      expect(result.minTimestamp).toBe(1000);
      expect(result.maxTimestamp).toBe(3000);
    });
  });

  describe('isEventInFuture', () => {
    const startTime = 1000;

    it('returns false for event at start when currentTime is 0', () => {
      expect(isEventInFuture(1000, startTime, 0)).toBe(false);
    });

    it('returns true for event after currentTime', () => {
      // Event at 1500ms, startTime 1000ms, currentTime 400ms
      // Event relative = 500, current = 400, so event is in future
      expect(isEventInFuture(1500, startTime, 400)).toBe(true);
    });

    it('returns false for event before or at currentTime', () => {
      // Event at 1500ms, startTime 1000ms, currentTime 600ms
      // Event relative = 500, current = 600, so event is not in future
      expect(isEventInFuture(1500, startTime, 600)).toBe(false);
    });

    it('returns false when event is exactly at currentTime', () => {
      expect(isEventInFuture(1500, startTime, 500)).toBe(false);
    });

    it('returns true for all events when currentTime is 0 (except startTime event)', () => {
      expect(isEventInFuture(1001, startTime, 0)).toBe(true);
      expect(isEventInFuture(2000, startTime, 0)).toBe(true);
      expect(isEventInFuture(5000, startTime, 0)).toBe(true);
    });

    it('throws on null eventTimestamp', () => {
      expect(() => isEventInFuture(null as unknown as number, startTime, 0)).toThrow('eventTimestamp is null');
    });

    it('throws on undefined startTime', () => {
      expect(() => isEventInFuture(1000, undefined as unknown as number, 0)).toThrow('startTime is null');
    });

    it('throws on null currentTime', () => {
      expect(() => isEventInFuture(1000, startTime, null as unknown as number)).toThrow('currentTime is null');
    });
  });

  describe('isFutureEvent (TimelineState interface)', () => {
    it('returns true for event in future', () => {
      expect(isFutureEvent(1500, { startTime: 1000, currentTime: 400 })).toBe(true);
    });

    it('returns false for event in past', () => {
      expect(isFutureEvent(1500, { startTime: 1000, currentTime: 600 })).toBe(false);
    });
  });

  describe('getEventRelativeTime', () => {
    it('calculates relative time correctly', () => {
      expect(getEventRelativeTime(1500, 1000)).toBe(500);
      expect(getEventRelativeTime(3000, 1000)).toBe(2000);
    });

    it('returns 0 for event at startTime', () => {
      expect(getEventRelativeTime(1000, 1000)).toBe(0);
    });

    it('throws if event is before startTime', () => {
      expect(() => getEventRelativeTime(500, 1000)).toThrow('before startTime');
    });

    it('throws on null eventTimestamp', () => {
      expect(() => getEventRelativeTime(null as unknown as number, 1000)).toThrow('eventTimestamp is null');
    });
  });

  describe('formatRelativeTime', () => {
    it('formats milliseconds to seconds with 3 decimal places', () => {
      expect(formatRelativeTime(0)).toBe('0.000');
      expect(formatRelativeTime(500)).toBe('0.500');
      expect(formatRelativeTime(1000)).toBe('1.000');
      expect(formatRelativeTime(1234)).toBe('1.234');
      expect(formatRelativeTime(12345)).toBe('12.345');
    });

    it('throws on NaN input', () => {
      expect(() => formatRelativeTime(NaN)).toThrow('invalid input');
    });
  });

  describe('Constants', () => {
    it('exports colour constants', () => {
      expect(HIGHLIGHT_COLOUR).toBe('#E87A5D');
      expect(DIMMED_COLOUR).toBe('#9CA3AF');
      expect(DIMMED_OPACITY).toBe(0.4);
      expect(FUTURE_EVENT_CLASS).toBe('future-event');
    });
  });
});
