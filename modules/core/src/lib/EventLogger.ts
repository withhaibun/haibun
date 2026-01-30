import { LogEvent, LifecycleEvent, TStepArgs } from '../schema/protocol.js';
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel } from '../schema/protocol.js';
import { TFeatureStep, TStepValuesMap } from './defs.js';
import { formatCurrentSeqPath } from './util/index.js';
import { willBeSecret } from './set-modifiers.js';
import { sanitize, obscureInText, TIsSecretFn, TGetSecretValueFn } from './sanitization.js';

export type { TIsSecretFn, TGetSecretValueFn };

export interface IEventLogger {
  suppressConsole?: boolean;
  setStepperCallback?(callback: (event: THaibunEvent) => void): void;
  emit(event: THaibunEvent): void;
  log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  debug(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs: TStepArgs, stepValuesMap?: TStepValuesMap, isSecretFn?: TIsSecretFn, getSecretValueFn?: TGetSecretValueFn, knownSecrets?: string[]): void;
  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error: string | Error | undefined, stepArgs: TStepArgs, stepValuesMap?: TStepValuesMap, topics?: Record<string, unknown>, isSecretFn?: TIsSecretFn, getSecretValueFn?: TGetSecretValueFn, knownSecrets?: string[]): void;
  artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void;
}

function getEmitter(): string {
  const stack = Error().stack?.split('\n');
  if (!stack || stack.length < 5) return 'unknown';
  for (let i = 3; i < Math.min(stack.length, 10); i++) {
    const line = stack[i];
    if (line.includes('EventLogger') || line.includes('emitLog')) continue;
    const match = line.match(/at\s+(?:(\S+)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      const [, func, path, row] = match;
      return `${path.split('/').pop()?.replace(/\.[^/.]+$/, '')}.${func?.split('.').pop() ?? 'at'}:${row}`;
    }
  }
  return 'unknown';
}

export class EventLogger implements IEventLogger {
  private stepperCallback?: (event: THaibunEvent) => void;
  public suppressConsole: boolean = false;
  private currentSecrets: string[] = [];

  constructor() {
    const forceNdjson = process.env['HAIBUN_NDJSON'] === 'true';
    const isTest = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
    this.suppressConsole = !forceNdjson && isTest;
  }

  setStepperCallback(callback: (event: THaibunEvent) => void): void { this.stepperCallback = callback; }

  emit(event: THaibunEvent): void {
    let evt = { ...event, emitter: event.emitter || getEmitter() };

    // Blanket sanitize using current step's known secrets
    if (this.currentSecrets.length > 0) {
      let str = JSON.stringify(evt);
      for (const secret of this.currentSecrets) {
        str = obscureInText(str, secret);
      }
      evt = JSON.parse(str);
    }

    this.stepperCallback?.(evt);
    if (!this.suppressConsole) console.log(JSON.stringify(evt));
  }

  log(featureStep: TFeatureStep, level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogEvent.parse({ id: formatCurrentSeqPath(featureStep.seqPath), timestamp: Date.now(), kind: 'log', level, message, attributes }));
  }

  info(message: string, attr?: Record<string, unknown>): void { this.emitLog('info', message, attr); }
  debug(message: string, attr?: Record<string, unknown>): void { this.emitLog('debug', message, attr); }
  warn(message: string, attr?: Record<string, unknown>): void { this.emitLog('warn', message, attr); }
  error(message: string, attr?: Record<string, unknown>): void { this.emitLog('error', message, attr); }

  private emitLog(level: THaibunLogLevel, message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogEvent.parse({ id: `log.${Date.now()}`, timestamp: Date.now(), kind: 'log', level, message, attributes }));
  }

  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs: TStepArgs, stepValuesMap?: TStepValuesMap, isSecretFn?: TIsSecretFn, getSecretValueFn?: TGetSecretValueFn, knownSecrets: string[] = []): void {
    const isSecretStep = willBeSecret(featureStep.action.step, stepValuesMap);

    // Sanitize using history (knownSecrets) + detection
    const { sanitizedMap, sanitizedArgs, sanitizedIn, secretValues } = sanitize(stepValuesMap, stepArgs, featureStep.in, isSecretStep, isSecretFn, getSecretValueFn, knownSecrets);

    // Track secrets for blanket emit() sanitization
    this.currentSecrets = [...new Set([...knownSecrets, ...secretValues])];

    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath), timestamp: Date.now(), kind: 'lifecycle', type: 'step', stage: 'start',
      in: sanitizedIn, lineNumber: featureStep.source.lineNumber, featurePath: featureStep.source.path,
      status: 'running', level: featureStep.isSubStep ? 'trace' : 'info',
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName, actionName, stepArgs: sanitizedArgs, stepValuesMap: sanitizedMap
    }));
  }

  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error: string | Error | undefined, stepArgs: TStepArgs, stepValuesMap?: TStepValuesMap, topics?: Record<string, unknown>, isSecretFn?: TIsSecretFn, getSecretValueFn?: TGetSecretValueFn, knownSecrets: string[] = []): void {
    const isSecretStep = willBeSecret(featureStep.action.step, stepValuesMap);

    // Sanitize using history (knownSecrets) + detection
    const { sanitizedMap, sanitizedArgs, sanitizedIn, secretValues } = sanitize(stepValuesMap, stepArgs, featureStep.in, isSecretStep, isSecretFn, getSecretValueFn, knownSecrets);

    // Track secrets for error message sanitization
    this.currentSecrets = [...new Set([...knownSecrets, ...secretValues])];

    let sanitizedError = error instanceof Error ? error.message : error;
    if (sanitizedError && this.currentSecrets.length > 0) {
      for (const secret of this.currentSecrets) {
        sanitizedError = obscureInText(sanitizedError, secret);
      }
    }

    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath), timestamp: Date.now(), kind: 'lifecycle', type: 'step', stage: 'end',
      in: sanitizedIn, lineNumber: featureStep.source.lineNumber, featurePath: featureStep.source.path,
      status: ok ? 'completed' : 'failed', level: featureStep.isSubStep ? 'trace' : 'info',
      error: sanitizedError,
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName, actionName, stepArgs: sanitizedArgs, stepValuesMap: sanitizedMap, topics
    }));

    // Reset current secrets for next event
    this.currentSecrets = [];
  }

  artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void {
    this.emit({ ...artifact, id: artifact.id || `${formatCurrentSeqPath(featureStep.seqPath)}.artifact`, timestamp: artifact.timestamp || Date.now() });
  }
}
