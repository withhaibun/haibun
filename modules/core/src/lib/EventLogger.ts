import { THaibunEvent, LogEvent, LifecycleEvent, TArtifactEvent, THaibunLogLevel } from '../schema/protocol.js';
import { TFeatureStep } from './defs.js';
import { formatCurrentSeqPath } from './util/index.js';

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
  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs?: Record<string, unknown>, stepValuesMap?: Record<string, unknown>): void;
  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error?: string | Error, stepArgs?: Record<string, unknown> | unknown[], stepValuesMap?: Record<string, unknown>, topics?: Record<string, unknown>): void;
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
      const [, func, path, row, col] = match;
      const shortFunc = func ? func.split('.').pop() : 'at';
      const file = path.split('/').pop();
      return `${shortFunc}:${row}|${path}:${row}:${col}`;
    }
  }
  return 'unknown';
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
      emitter: (event as any).emitter || getEmitter(),
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


  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs?: Record<string, unknown>, stepValuesMap?: Record<string, unknown>): void {
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
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName,
      stepArgs,
      stepValuesMap
    }));
  }

  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error?: string | Error, stepArgs?: Record<string, unknown> | unknown[], stepValuesMap?: Record<string, unknown>, topics?: Record<string, unknown>): void {
    const errorMessage = error instanceof Error ? error.message : error;
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
      error: errorMessage,
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName,
      stepArgs: stepArgs as any, // Cast to match Zod union type if needed
      stepValuesMap,
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

