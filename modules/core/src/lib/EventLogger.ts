import { THaibunEvent, LogEvent, LifecycleEvent, TArtifactEvent, ImageArtifact, VideoArtifact, VideoStartArtifact, HtmlArtifact, SpeechArtifact, JsonArtifact, MermaidArtifact, HttpTraceArtifact, ResolvedFeaturesArtifact, FileArtifact } from '../schema/events.js';
import { TFeatureStep } from './defs.js';
import { formatCurrentSeqPath } from './util/index.js';

// Re-export THaibunEvent for use in defs.ts
export type { THaibunEvent } from '../schema/events.js';

// Re-export artifact schemas for use by artifact producers
export {
  ImageArtifact,
  VideoArtifact,
  VideoStartArtifact,
  HtmlArtifact,
  SpeechArtifact,
  JsonArtifact,
  MermaidArtifact,
  HttpTraceArtifact,
  ResolvedFeaturesArtifact,
  FileArtifact,
} from '../schema/events.js';

export type { TArtifactEvent } from '../schema/events.js';

export interface IEventLogger {
  suppressConsole?: boolean;
  setStepperCallback?(callback: (event: THaibunEvent) => void): void;
  emit(event: THaibunEvent): void;
  log(featureStep: TFeatureStep, level: 'info' | 'debug' | 'trace' | 'warn' | 'error', message: string, payload?: Record<string, unknown>): void;
  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs?: Record<string, unknown>): void;
  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error?: string | Error): void;
  artifact(featureStep: TFeatureStep, artifact: TArtifactEvent): void;
}

/**
 * Get caller info for the emitter field (e.g., "Executor:238")
 */
function getEmitter(): string {
  const stack = Error().stack?.split('\n');
  if (!stack || stack.length < 5) return 'unknown';
  // Find the first non-EventLogger caller
  for (let i = 3; i < Math.min(stack.length, 8); i++) {
    const line = stack[i];
    if (line.includes('EventLogger')) continue;
    const match = line.match(/at\s+(?:\w+\.)?(\w+)\s+.*:(\d+):\d+/);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
    // Handle "at file:..." pattern
    const fileMatch = line.match(/\/([^/]+)\.(?:ts|js):(\d+):\d+/);
    if (fileMatch) {
      return `${fileMatch[1]}:${fileMatch[2]}`;
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

  log(featureStep: TFeatureStep, level: 'info' | 'debug' | 'trace' | 'warn' | 'error', message: string, payload?: Record<string, unknown>): void {
    this.emit(LogEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'log',
      level,
      message,
      payload
    }));
  }

  stepStart(featureStep: TFeatureStep, stepperName: string, actionName: string, stepArgs?: Record<string, unknown>): void {
    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'lifecycle',
      type: 'step',
      stage: 'start',
      in: featureStep.in,
      status: 'running',
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName,
      stepArgs
    }));
  }

  stepEnd(featureStep: TFeatureStep, stepperName: string, actionName: string, ok: boolean, error?: string | Error): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.emit(LifecycleEvent.parse({
      id: formatCurrentSeqPath(featureStep.seqPath),
      timestamp: Date.now(),
      kind: 'lifecycle',
      type: 'step',
      stage: 'end',
      in: featureStep.in,
      status: ok ? 'completed' : 'failed',
      error: errorMessage,
      intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
      stepperName,
      actionName
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

