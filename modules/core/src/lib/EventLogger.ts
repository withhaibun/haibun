import { LogEvent, LifecycleEvent } from '../schema/protocol.js';
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel } from '../schema/protocol.js';
import { TFeatureStep } from './defs.js';
import { OBSCURED_VALUE } from './feature-variables.js';
import { formatCurrentSeqPath } from './util/index.js';

export type TIsSecretFn = (name: string) => boolean;

export interface IEventLogger {
  suppressConsole?: boolean;
  setStepperCallback?(callback: (event: THaibunEvent) => void): void;
  emit(event: THaibunEvent): void;
  log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void;
  // Convenience methods for logging without a featureStep
  info(message: string, attributes?: Record<string, unknown>): void;
  debug(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs: Record<string, unknown>, stepValuesMap: Record<string, unknown> | undefined, isSecretFn: TIsSecretFn): void;
  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error: string | Error | undefined, stepArgs: Record<string, unknown> | unknown[], stepValuesMap: Record<string, unknown> | undefined, topics: Record<string, unknown> | undefined, isSecretFn: TIsSecretFn): void;
  artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void;
}

/**
 * Get caller info for the emitter field (e.g., "Executor:238")
 */
function getEmitter(): string {
  const stack = Error().stack?.split('\n');
  if (!stack || stack.length < 5) return 'unknown';
  // Find the first non-EventLogger caller
  for (let i = 3; i < Math.min(stack.length, 10); i++) {
    const line = stack[i];
    if (line.includes('EventLogger') || line.includes('emitLog')) continue;
    // Capture function, path, line, col
    // Example: at Executor.doFeatureStep (/home/.../Executor.ts:287:11)
    const match = line.match(/at\s+(?:(\S+)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      const [, func, path, row] = match;
      const shortFunc = func ? func.split('.').pop() : 'at';
      const file = path.split('/').pop()?.replace(/\.[^/.]+$/, '');
      return `${file}.${shortFunc}:${row}`;
    }
  }
  return 'unknown';
}

/**
 * Obscure secret values in stepValuesMap for safe emission.
 * Secret values have their value replaced with OBSCURED_VALUE.
 */
function obscureSecretValues(
  stepValuesMap: Record<string, unknown> | undefined,
  isSecretFn: TIsSecretFn
): Record<string, unknown> | undefined {
  if (!stepValuesMap) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stepValuesMap)) {
    if (isSecretFn(key)) {
      // Obscure the value while preserving structure
      if (typeof value === 'object' && value !== null && 'value' in value) {
        result[key] = { ...value, value: OBSCURED_VALUE };
      } else {
        result[key] = OBSCURED_VALUE;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class EventLogger implements IEventLogger {
  private stepperCallback?: (event: THaibunEvent) => void;
  public suppressConsole: boolean = false;

  constructor() {
    // HAIBUN_NDJSON=true forces NDJSON output (for debugging tests)
    // Otherwise suppress in test environments (VITEST or NODE_ENV=test)
    const forceNdjson = process.env['HAIBUN_NDJSON'] === 'true';
    const isTest = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
    this.suppressConsole = !forceNdjson && isTest;
  }
  setStepperCallback(callback: (event: THaibunEvent) => void): void {
    this.stepperCallback = callback;
  }

  emit(event: THaibunEvent): void {
    // Add emitter info if not already present
    const eventWithEmitter = {
      ...event,
      emitter: event.emitter || getEmitter(),
    };

    // Route through stepper callback for in-process monitors
    if (this.stepperCallback) {
      this.stepperCallback(eventWithEmitter);
    }
    // Output to stdout for CLI piping (unless suppressed)
    if (!this.suppressConsole) {
      console.log(JSON.stringify(eventWithEmitter));
    }
  }

  log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'log',
      level,
      message,
      attributes
    }));
  }

  // Convenience methods for logging without a featureStep (for cycles, helpers, etc.)
  info(message: string, attributes?: Record<string, unknown>): void {
    this.emitLog('info', message, attributes);
  }

  debug(message: string, attributes?: Record<string, unknown>): void {
    this.emitLog('debug', message, attributes);
  }

  warn(message: string, attributes?: Record<string, unknown>): void {
    this.emitLog('warn', message, attributes);
  }

  error(message: string, attributes?: Record<string, unknown>): void {
    this.emitLog('error', message, attributes);
  }

  private emitLog(level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogEvent.parse({
      id: `log.${Date.now()}`,
      timestamp: Date.now(),
      kind: 'log',
      level,
      message,
      attributes
    }));
  }


  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs: Record<string, unknown>, stepValuesMap: Record<string, unknown> | undefined, isSecretFn: TIsSecretFn): void {
    const safeStepValuesMap = obscureSecretValues(stepValuesMap, isSecretFn);
    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'lifecycle',
      type: 'step',
      stage: 'start',
      in: featureStep.in,
      lineNumber: featureStep.source.lineNumber,
      featurePath: featureStep.source.path,
      status: 'running',
      level: featureStep.isSubStep ? 'trace' : 'info',
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName,
      stepArgs,
      stepValuesMap: safeStepValuesMap
    }));
  }

  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error: string | Error | undefined, stepArgs: Record<string, unknown> | unknown[], stepValuesMap: Record<string, unknown> | undefined, topics: Record<string, unknown> | undefined, isSecretFn: TIsSecretFn): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const safeStepValuesMap = obscureSecretValues(stepValuesMap, isSecretFn);
    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'lifecycle',
      type: 'step',
      stage: 'end',
      in: featureStep.in,
      lineNumber: featureStep.source.lineNumber,
      featurePath: featureStep.source.path,
      status: ok ? 'completed' : 'failed',
      level: featureStep.isSubStep ? 'trace' : 'info',
      error: errorMessage,
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName,
      stepArgs: stepArgs as Record<string, unknown> | unknown[], // Match Zod union type
      stepValuesMap: safeStepValuesMap,
      topics
    }));
  }

  /**
   * Emit an artifact event. The artifact should already be a valid TArtifactEvent
   * (parsed via the appropriate Zod schema like ImageArtifact.parse()).
   */
  artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void {
    // Ensure the event has proper id and timestamp
    const event: TArtifactEvent = {
      ...artifact,
      id: artifact.id || `${formatCurrentSeqPath(featureStep.seqPath)}.artifact`,
      timestamp: artifact.timestamp || Date.now(),
    };
    this.emit(event);
  }
}

