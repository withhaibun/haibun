/**
 * Timeline - All timeline-related types, functions, and styling constants.
 * 
 * This module provides:
 * - Timeline state interface
 * - Pure functions for timeline calculations (throw on invalid input)
 * - Colour/style constants for timeline highlighting and dimming
 */

import { THaibunEvent } from '@haibun/core/schema/protocol.js';

// ========================
// Types and Interfaces
// ========================

/**
 * Timeline state interface for consistent time tracking across views.
 * Used to pass timeline state to sequence diagrams, quad graphs, and document view.
 */
export interface TimelineState {
  /** Current playback time in milliseconds relative to startTime */
  currentTime: number;
  /** Start time (first event timestamp) in epoch milliseconds */
  startTime: number;
}

/**
 * Result of calculating timeline bounds from events
 */
export interface TimelineBounds {
  minTimestamp: number;
  maxTimestamp: number;
  duration: number;
}

// ========================
// Colour and Style Constants
// ========================

/** Highlight colour for current/active elements (orange-red) */
export const HIGHLIGHT_COLOUR = '#E87A5D';

/** Dimmed colour for future/inactive elements (gray) */
export const DIMMED_COLOUR = '#9CA3AF';

/** Opacity for future/dimmed events - shared across all views */
export const DIMMED_OPACITY = 0.4;

/** CSS class name for future events (applies dimming styles) */
export const FUTURE_EVENT_CLASS = 'future-event';

// ========================
// Pure Calculation Functions
// ========================

/**
 * Check if an event timestamp is in the future relative to timeline state.
 * @param timestamp - Event timestamp in epoch milliseconds  
 * @param timeline - Current timeline state
 * @returns true if the event is in the future
 */
export function isFutureEvent(timestamp: number, timeline: TimelineState): boolean {
  const relativeTime = timestamp - timeline.startTime;
  return relativeTime > timeline.currentTime;
}

/**
 * Calculate the timeline bounds from a list of events.
 * 
 * @throws Error if events is empty
 * @throws Error if no events have valid timestamps
 */
export function calculateTimelineBounds(events: THaibunEvent[]): TimelineBounds {
  if (events.length === 0) {
    throw new Error('calculateTimelineBounds: events array is empty');
  }

  let min = Infinity;
  let max = -Infinity;

  for (const e of events) {
    if (e.timestamp !== undefined && e.timestamp !== null && typeof e.timestamp === 'number') {
      if (e.timestamp < min) min = e.timestamp;
      if (e.timestamp > max) max = e.timestamp;
    }
  }

  if (min === Infinity || max === -Infinity) {
    throw new Error('calculateTimelineBounds: no events have valid timestamps');
  }

  if (max < min) {
    throw new Error(`calculateTimelineBounds: invalid bounds max(${max}) < min(${min})`);
  }

  return {
    minTimestamp: min,
    maxTimestamp: max,
    duration: max - min
  };
}

/**
 * Determine if an event is in the future relative to the current timeline position.
 * 
 * @param eventTimestamp - The timestamp of the event
 * @param startTime - The timeline start time (should equal minTimestamp)
 * @param currentTime - Current position in timeline (0 = beginning, duration = end)
 * @returns true if the event is in the future
 * @throws Error if any parameter is null/undefined
 */
export function isEventInFuture(
  eventTimestamp: number,
  startTime: number,
  currentTime: number
): boolean {
  if (eventTimestamp === null || eventTimestamp === undefined) {
    throw new Error('isEventInFuture: eventTimestamp is null/undefined');
  }
  if (startTime === null || startTime === undefined) {
    throw new Error('isEventInFuture: startTime is null/undefined');
  }
  if (currentTime === null || currentTime === undefined) {
    throw new Error('isEventInFuture: currentTime is null/undefined');
  }

  // Event's relative position in the timeline
  const eventRelativeTime = eventTimestamp - startTime;

  return eventRelativeTime > currentTime;
}

/**
 * Calculate the relative time of an event in the timeline.
 * 
 * @param eventTimestamp - The timestamp of the event
 * @param startTime - The timeline start time
 * @returns Relative time in milliseconds from start
 * @throws Error if parameters are invalid
 */
export function getEventRelativeTime(
  eventTimestamp: number,
  startTime: number
): number {
  if (eventTimestamp === null || eventTimestamp === undefined) {
    throw new Error('getEventRelativeTime: eventTimestamp is null/undefined');
  }
  if (startTime === null || startTime === undefined) {
    throw new Error('getEventRelativeTime: startTime is null/undefined');
  }

  const relative = eventTimestamp - startTime;

  if (relative < 0) {
    throw new Error(`getEventRelativeTime: event timestamp (${eventTimestamp}) is before startTime (${startTime})`);
  }

  return relative;
}

/**
 * Format relative time for display (in seconds with 3 decimal places)
 */
export function formatRelativeTime(relativeTimeMs: number): string {
  if (typeof relativeTimeMs !== 'number' || Number.isNaN(relativeTimeMs)) {
    throw new Error('formatRelativeTime: invalid input');
  }
  return (relativeTimeMs / 1000).toFixed(3);
}
