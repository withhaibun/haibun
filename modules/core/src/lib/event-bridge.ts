/**
 * Utility functions for bridging TMessageContext (old) to THaibunEvent (new).
 * 
 * This module provides conversion utilities to enable gradual migration from
 * the legacy TMessageContext/EExecutionMessageType system to the new 
 * THaibunEvent Zod-validated event system.
 */

import { THaibunEvent, TLifecycleEvent, TLogEvent, TControlEvent } from '../schema/events.js';
import { TMessageContext, EExecutionMessageType, TLogLevel } from './interfaces/logger.js';

/**
 * Maps EExecutionMessageType to THaibunEvent lifecycle types
 */
type LifecycleTypeMapping = {
  type: 'feature' | 'scenario' | 'step' | 'activity' | 'waypoint' | 'ensure' | 'execution';
  stage: 'start' | 'end';
};

const INCIDENT_TO_LIFECYCLE: Partial<Record<EExecutionMessageType, LifecycleTypeMapping>> = {
  [EExecutionMessageType.FEATURE_START]: { type: 'feature', stage: 'start' },
  [EExecutionMessageType.FEATURE_END]: { type: 'feature', stage: 'end' },
  [EExecutionMessageType.SCENARIO_START]: { type: 'scenario', stage: 'start' },
  [EExecutionMessageType.SCENARIO_END]: { type: 'scenario', stage: 'end' },
  [EExecutionMessageType.STEP_START]: { type: 'step', stage: 'start' },
  [EExecutionMessageType.STEP_END]: { type: 'step', stage: 'end' },
  [EExecutionMessageType.EXECUTION_START]: { type: 'execution', stage: 'start' },
  [EExecutionMessageType.EXECUTION_END]: { type: 'execution', stage: 'end' },
  [EExecutionMessageType.ENSURE_START]: { type: 'ensure', stage: 'start' },
  [EExecutionMessageType.ENSURE_END]: { type: 'ensure', stage: 'end' },
};

/**
 * Convert a TMessageContext to a THaibunEvent.
 * 
 * @param message - The log message
 * @param level - The log level
 * @param context - The legacy TMessageContext
 * @param seqPath - Optional seqPath for event ID
 * @returns THaibunEvent or null if conversion not applicable
 */
export function messageContextToEvent(
  message: string,
  level: TLogLevel,
  context?: TMessageContext,
  seqPath: string = '0'
): THaibunEvent | null {
  if (!context) {
    // No context means a simple log message
    return {
      id: seqPath,
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'log',
      level: level === 'log' ? 'info' : level as TLogEvent['level'],
      message,
    } as TLogEvent;
  }

  const { incident, incidentDetails } = context;

  // Check if this is a lifecycle event
  const lifecycleMapping = INCIDENT_TO_LIFECYCLE[incident];
  if (lifecycleMapping) {
    const lifecycleEvent: TLifecycleEvent = {
      id: seqPath,
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'lifecycle',
      type: lifecycleMapping.type,
      stage: lifecycleMapping.stage,
      label: message,
      status: incidentDetails?.ok === false ? 'failed' :
        lifecycleMapping.stage === 'start' ? 'running' : 'completed',
      error: incidentDetails?.error?.message,
      stepperName: incidentDetails?.stepperName,
      actionName: incidentDetails?.actionName,
    };
    return lifecycleEvent;
  }

  // Check if this is a control event (DEBUG, GRAPH_LINK)
  if (incident === EExecutionMessageType.DEBUG) {
    const controlEvent: TControlEvent = {
      id: seqPath,
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'control',
      signal: incidentDetails?.rerunStep ? 'break' :
        incidentDetails?.nextStep ? 'resume' : 'pause',
      payload: incidentDetails || {},
    };
    return controlEvent;
  }

  if (incident === EExecutionMessageType.GRAPH_LINK) {
    const controlEvent: TControlEvent = {
      id: seqPath,
      timestamp: Date.now(),
      source: 'haibun',
      kind: 'control',
      signal: 'graph-link',
      payload: incidentDetails || {},
    };
    return controlEvent;
  }

  // Default: treat as log event
  return {
    id: seqPath,
    timestamp: Date.now(),
    source: 'haibun',
    kind: 'log',
    level: level === 'log' ? 'info' : level as TLogEvent['level'],
    message,
    payload: incidentDetails,
  } as TLogEvent;
}

/**
 * Check if a TMessageContext represents a lifecycle event
 */
export function isLifecycleContext(context?: TMessageContext): boolean {
  if (!context) return false;
  return context.incident in INCIDENT_TO_LIFECYCLE;
}

/**
 * Check if a TMessageContext represents a control event
 */
export function isControlContext(context?: TMessageContext): boolean {
  if (!context) return false;
  return context.incident === EExecutionMessageType.DEBUG ||
    context.incident === EExecutionMessageType.GRAPH_LINK;
}
