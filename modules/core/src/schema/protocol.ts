import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const HAIBUN_LOG_LEVELS = ['debug', 'trace', 'log', 'info', 'warn', 'error'] as const;
export const HaibunLogLevel = z.enum(HAIBUN_LOG_LEVELS);
export type THaibunLogLevel = z.infer<typeof HaibunLogLevel>;

export const CHECK_YES = '✅';
export const CHECK_NO = '❌';
export const CHECK_YIELD = '🔀'
export const MAYBE_CHECK_YES = '✓';
export const MAYBE_CHECK_NO = '✗';

export const ICON_FEATURE = '📄';
export const ICON_SCENARIO = '📋';
export const ICON_STEP_RUNNING = '⏳';
export const ICON_STEP_FAILED = '❌';
export const ICON_STEP_COMPLETED = '✅';
export const ICON_LOG_INFO = 'ℹ️';
export const ICON_LOG_WARN = '⚠️';
export const ICON_LOG_ERROR = '🚨';
export const ICON_DEFAULT = '•';
export const ICON_ARTIFACT = '📎';

export enum Origin {
  defined = 'defined',
  var = 'var',
  env = 'env',
  quoted = 'quoted',
  statement = 'statement',
}
export type TOrigin = keyof typeof Origin;

export type TDebugSignal = 'fail' | 'step' | 'continue' | 'retry' | 'next';

export const SCENARIO_START = 'scenario';
export const FEATURE_START = 'feature';

export const STAY_ALWAYS = 'always';
export const STAY_FAILURE = 'failure';
export const STAY = 'STAY';

export const STEP_DELAY = 'STEP_DELAY';
export const DEFAULT_DEST = 'default';
export const TEST_BASE = 'test_base';
export const CONTINUE_AFTER_ERROR = 'CONTINUE_AFTER_ERROR';

export const HAIBUN = 'HAIBUN';
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = 'capture';

export const TEND_FEATURE_DEFAULTS = { shouldClose: true, isLast: true, okSoFar: true, continueAfterError: true, stayOnFailure: true, thisFeatureOK: true };

// ============================================================================
// Environment Stubs & Utilities
// ============================================================================

export type TAnyFixme = any;

export class Timer {
  static startTime = new Date();
  static key = `${Timer.startTime.getTime()}`;
  static START_TIME = Date.now();

  static since() {
    return Date.now() - Timer.START_TIME;
  }
}

export function shortenURI(uri: string): string {
  try {
    const url = new URL(uri);
    return url.pathname.split('/').pop() || uri;
  } catch {
    return uri;
  }
}

// ============================================================================
// Serialization
// ============================================================================

interface JITSchema {
  _meta: 'schema';
  id: string;
  fields: string[];
}

interface JITData {
  s: string;
  d: any[];
}

export class JITSerializer {
  private schemas = new Map<string, string[]>();
  private nextSchemaId = 1;

  serialize(events: THaibunEvent[]): string {
    const lines: string[] = [];
    this.schemas.clear();
    this.nextSchemaId = 1;

    for (const event of events) {
      const schemaId = this.getSchemaId(event);
      const schemaFields = this.schemas.get(schemaId)!;

      // If first use of this schema, emit definition
      if (!lines.some(l => l.includes(`"_meta":"schema","id":"${schemaId}"`))) {
        lines.push(JSON.stringify({
          _meta: 'schema',
          id: schemaId,
          fields: schemaFields
        }));
      }

      // Emit data
      const validFields = schemaFields.map(f => (event as any)[f]);
      lines.push(JSON.stringify({ s: schemaId, d: validFields }));
    }

    return lines.join('\n');
  }

  deserialize(input: string): THaibunEvent[] {
    const lines = input.split('\n').filter(Boolean);
    const schemas = new Map<string, string[]>();
    const events: THaibunEvent[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as JITSchema | JITData;
        if ('_meta' in obj && obj._meta === 'schema') {
          schemas.set(obj.id, obj.fields);
        } else if ('s' in obj && 'd' in obj) {
          const fields = schemas.get(obj.s);
          if (fields) {
            const event: any = {};
            fields.forEach((field, i) => {
              event[field] = obj.d[i];
            });
            events.push(event);
          }
        }
      } catch (e) {
        console.error('Failed to parse JIT line', line, e);
      }
    }
    return events;
  }

  private getSchemaId(event: THaibunEvent): string {
    const keys = Object.keys(event).sort();
    const signature = keys.join(',');

    for (const [id, fields] of this.schemas.entries()) {
      if (fields.join(',') === signature) {
        return id;
      }
    }

    const newId = `${event.kind}-${this.nextSchemaId++}`;
    this.schemas.set(newId, keys);
    return newId;
  }
}

// ============================================================================
// Formatting
// ============================================================================

export type TIndication = 'success' | 'failure' | 'speculative-failure' | 'pending' | 'neutral';

export class EventFormatter {
  static shouldDisplay(event: THaibunEvent, minLevel: THaibunLogLevel = 'info'): boolean {
    const minLevelIndex = HAIBUN_LOG_LEVELS.indexOf(minLevel);
    const eventLevelIndex = HAIBUN_LOG_LEVELS.indexOf(event.level);

    if (eventLevelIndex < minLevelIndex) {
      return false;
    }

    if (event.kind === 'lifecycle') {
      if (event.type === 'step') return event.stage === 'end';
      if (event.type === 'feature' || event.type === 'scenario') return event.stage === 'start';
      return false;
    }
    if (event.kind === 'log') {
      return true;
    }
    return false;
  }

  static getDisplayLevel(event: THaibunEvent): string {
    if (event.kind === 'lifecycle') {
      return 'info';
    }
    if (event.kind === 'log') {
      return event.level;
    }
    return 'info';
  }

  static getStatusIcon(event: THaibunEvent & { kind: 'lifecycle' }): string {
    const isSpeculative = event.intent?.mode === 'speculative';
    if (event.status === 'completed') return isSpeculative ? ` ${MAYBE_CHECK_YES}` : ICON_STEP_COMPLETED;
    if (event.status === 'failed') return isSpeculative ? ` ${MAYBE_CHECK_NO}` : ICON_STEP_FAILED;
    if (event.status === 'running') return ICON_STEP_RUNNING;
    return ` ${ICON_DEFAULT}`;
  }

  static getIndication(event: THaibunEvent & { kind: 'lifecycle' }): TIndication {
    const isSpeculative = event.intent?.mode === 'speculative';
    if (event.status === 'completed') return 'success';
    if (event.status === 'failed') return isSpeculative ? 'speculative-failure' : 'failure';
    if (event.status === 'running') return 'pending';
    return 'neutral';
  }

  static formatLineElements(event: THaibunEvent, lastLevel?: string) {
    const time = (Timer.since() / 1000).toFixed(3);
    const emitter = event.emitter || event.source;
    const level = this.getDisplayLevel(event);
    const showLevel = lastLevel === level ? level.charAt(0) : level;

    let icon = '';
    let id = '';
    let message = '';

    if (event.kind === 'lifecycle') {
      if (event.type === 'feature') {
        icon = ICON_FEATURE;
        message = event.featurePath;
      } else if (event.type === 'scenario') {
        icon = ICON_SCENARIO;
        message = event.scenarioName;
      } else {
        icon = this.getStatusIcon(event);
        id = event.id ? `${event.id}` : '';
        // Step always has 'in', other events (activity, etc) may not
        if (event.type === 'step') {
          message = event.in;
        } else {
          // Other lifecycle events (activity, ensure, etc)
          if (event.in) {
            message = event.in;
          }
        }

        if (event.error) message += ` (${event.error})`;
      }
    } else if (event.kind === 'log') {
      const levelIcons: Record<string, string> = { info: ICON_LOG_INFO, warn: ICON_LOG_WARN, error: ICON_LOG_ERROR };
      icon = levelIcons[event.level] || ICON_DEFAULT;
      id = event.id ? `${event.id}` : '';
      message = event.message;
    }
    return { time, emitter, level, showLevel, icon, id, message };
  }

  static formatLine(event: THaibunEvent, lastLevel?: string): string {
    const { time, emitter, level, showLevel, icon, id, message } = this.formatLineElements(event, lastLevel);
    const prefix = showLevel.padStart(8) + ` █ ${time}:${emitter}`.padEnd(32) + ` ｜ `;
    return prefix + `${icon} ${id} ${message}`;
  }
}


// ============================================================================
// Execution Protocol
// ============================================================================

export const ExecutionIntentSchema = z.object({
  mode: z.enum(['authoritative', 'speculative', 'prose']).default('authoritative'),
  usage: z.enum(['testing', 'debugging', 'background', 'polling']).optional(),
  stepperOptions: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

export const FlowSignalSchema = z.object({
  kind: z.enum(['ok', 'fail', 'retry', 'skip']),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
  topics: z.unknown().optional(),
});
export type FlowSignal = z.infer<typeof FlowSignalSchema>;

export const SystemMessageSchema = z.object({
  topic: z.string().optional(),
  signal: FlowSignalSchema,
  intent: ExecutionIntentSchema,
});
export type SystemMessage = z.infer<typeof SystemMessageSchema>;

export type TOKActionResult = {
  ok: true;
  controlSignal?: TDebugSignal;
  artifact?: TArtifactEvent;
  protocol?: SystemMessage;
  topics?: Record<string, unknown>;
};

export type TNotOKActionResult = {
  ok: false;
  message: string;
  controlSignal?: TDebugSignal;
  artifact?: TArtifactEvent;
  protocol?: SystemMessage;
  topics?: Record<string, unknown>;
};

export type TActionResult = TOKActionResult | TNotOKActionResult;

export const OK: TOKActionResult = { ok: true };

export type TStepValueValue = unknown;
export type TStepArgs = Record<string, TStepValueValue>;

export type TStepValue = {
  term: string;
  domain: string;
  value?: TStepValueValue;
  origin: TOrigin;
  provenance?: TProvenanceIdentifier[];
  readonly?: boolean;
};

export type TProvenanceIdentifier = { in?: string; seq: number[]; when: string };

// Result Types
export type TTrace = {
  [name: string]: {
    url: string;
    since: number;
    trace: TAnyFixme;
  };
};

export type TTraces = {
  start?: number;
  end?: number;
  traces?: TTrace[];
};

export type TStepActionResult = (TNotOkStepActionResult | TOKStepActionResult) & TTraces;

type TNamedStepActionResult = {
  name: string;
};

export type TNotOkStepActionResult = TNotOKActionResult & TNamedStepActionResult;
export type TOKStepActionResult = TOKActionResult & TNamedStepActionResult;

export type TSeqPath = number[];

export type TStepResult = {
  ok: boolean;
  stepActionResult: TStepActionResult;
  in: string;
  path: string;
  lineNumber?: number;
  seqPath: TSeqPath;
  intent?: ExecutionIntent;
};

export type TFeatureResult = {
  skip?: boolean;
  path: string;
  ok: boolean;
  stepResults: TStepResult[];
  failure?: {
    message: string;
    error: TAnyFixme;
    expected?: TAnyFixme;
  };
};

export type TExecutorResult = {
  ok: boolean;
  tag: any;
  shared: any;
  featureResults?: TFeatureResult[];
  failure?: {
    stage: string;
    error: {
      details: Record<string, TAnyFixme>;
      message: string;
    };
  };
  steppers?: any[];
};


// ============================================================================
// Prompt Types
// ============================================================================

export const Prompt = z.object({
  id: z.string(),
  message: z.string(),
  context: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});
export type TPrompt = z.infer<typeof Prompt>;

// ============================================================================
// Event Schema
// ============================================================================

export const BaseEvent = z.object({
  id: z.string().describe('Unique identifier for the event, typically the seqPath'),
  timestamp: z.number().int().describe('Absolute epoch timestamp in milliseconds'),
  source: z.string().default('haibun').describe('Source of the event'),
  emitter: z.string().optional().describe('Code location that emitted the event (e.g. Executor:238)'),
  level: HaibunLogLevel.default('info').describe('Log level for filtering'),
});

// Lifecycle Events
// Lifecycle Events
export const LifecycleEventCommon = BaseEvent.extend({
  kind: z.literal('lifecycle'),
  stage: z.enum(['start', 'end']),

  // Execution Context
  status: z.enum(['running', 'completed', 'failed', 'skipped']).optional(),
  error: z.string().optional(),

  // Execution Intent
  intent: z.object({
    mode: z.enum(['speculative', 'authoritative']).optional()
  }).optional(),
});

// Specific Events
export const FeatureEvent = LifecycleEventCommon.extend({
  type: z.literal('feature'),
  featurePath: z.string().describe('Feature file path'),
});

export const ScenarioEvent = LifecycleEventCommon.extend({
  type: z.literal('scenario'),
  scenarioName: z.string().describe('Scenario name'),
  featurePath: z.string().optional(),
});

export const StepEvent = LifecycleEventCommon.extend({
  type: z.literal('step'),
  in: z.string().describe('Step text'),
  lineNumber: z.number().optional(),
  stepperName: z.string().optional(),
  actionName: z.string().optional(),
  stepArgs: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  stepValuesMap: z.record(z.string(), z.unknown()).optional(),
  topics: z.record(z.string(), z.unknown()).optional(),
  featurePath: z.string().optional(),
});

// For other types (activity, waypoint, ensure, execution)
export const GenericLifecycleEvent = LifecycleEventCommon.extend({
  type: z.enum(['activity', 'waypoint', 'ensure', 'execution']),
  in: z.string().optional(),
  topics: z.record(z.string(), z.unknown()).optional(),
  lineNumber: z.number().optional(),
  featurePath: z.string().optional(),
});

export const LifecycleEvent = z.union([
  FeatureEvent,
  ScenarioEvent,
  StepEvent,
  GenericLifecycleEvent
]);

// Log Events
export const LogEvent = BaseEvent.extend({
  kind: z.literal('log'),
  level: HaibunLogLevel,
  message: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(), // Structured log data
});

// Artifact Events - Base
const BaseArtifact = BaseEvent.extend({
  kind: z.literal('artifact'),
});

// Artifact Subtypes
export const ImageArtifact = BaseArtifact.extend({
  artifactType: z.literal('image'),
  path: z.string(),
  mimetype: z.string().default('image/png'),
});

export const VideoArtifact = BaseArtifact.extend({
  artifactType: z.literal('video'),
  path: z.string(),
  mimetype: z.string().default('video/webm'),
  isTimeLined: z.boolean().default(true),
  startTime: z.number().optional().describe('Epoch timestamp when video recording started'),
  duration: z.number().optional(),
});

export const VideoStartArtifact = BaseArtifact.extend({
  artifactType: z.literal('video-start'),
  startTime: z.number().describe('Relative start time of video in milliseconds'),
});

export const HtmlArtifact = BaseArtifact.extend({
  artifactType: z.literal('html'),
  path: z.string(),
  mimetype: z.string().default('text/html'),
});

export const SpeechArtifact = BaseArtifact.extend({
  artifactType: z.literal('speech'),
  path: z.string(),
  mimetype: z.string().default('audio/mpeg'),
  transcript: z.string().optional(),
  durationS: z.number().optional(),
});

export const JsonArtifact = BaseArtifact.extend({
  artifactType: z.literal('json'),
  json: z.record(z.string(), z.unknown()),
  mimetype: z.string().default('application/json'),
});

export const MermaidArtifact = BaseArtifact.extend({
  artifactType: z.literal('mermaid'),
  source: z.string(),
  mimetype: z.string().default('text/x-mermaid'),
});

export const HttpTraceArtifact = BaseArtifact.extend({
  artifactType: z.literal('http-trace'),
  httpEvent: z.enum(['request', 'response', 'route']),
  trace: z.object({
    frameURL: z.string().optional(),
    requestingPage: z.string().optional(),
    requestingURL: z.string().optional(),
    method: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    postData: z.unknown().optional(),
    status: z.number().optional(),
    statusText: z.string().optional(),
  }),
  mimetype: z.string().default('application/json'),
});

export const RegisteredOutcomeEntry = z.object({
  proofStatements: z.array(z.string()).optional(),
  proofPath: z.string().optional(),
  isBackground: z.boolean().optional(),
  activityBlockSteps: z.array(z.string()).optional(),
});
export type TRegisteredOutcomeEntry = z.infer<typeof RegisteredOutcomeEntry>;

export const ResolvedFeaturesArtifact = BaseArtifact.extend({
  artifactType: z.literal('resolvedFeatures'),
  resolvedFeatures: z.array(z.unknown()),
  index: z.number().optional(),
  registeredOutcomes: z.record(z.string(), RegisteredOutcomeEntry).optional(),
  mimetype: z.string().default('application/json'),
});

// Generic file artifact for other types
export const FileArtifact = BaseArtifact.extend({
  artifactType: z.literal('file'),
  path: z.string(),
  mimetype: z.string(),
});

export const ArtifactEvent = z.discriminatedUnion('artifactType', [
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
]);

// Control Events
export const ControlEvent = BaseEvent.extend({
  kind: z.literal('control'),
  // Debugger signals: fail, step, continue, retry, next
  // System signals: graph-link, break, pause, resume
  signal: z.enum([
    'fail',      // fail execution
    'step',      // single-step mode
    'continue',  // continue without debug
    'retry',     // retry failed step (rerunStep)
    'next',      // skip to next step (nextStep)
    'graph-link',
    'break',
    'pause',
    'resume'
  ]),
  args: z.record(z.string(), z.unknown()).optional(),
});

// Union Type
export const HaibunEvent = z.union([
  LifecycleEvent,
  LogEvent,
  ArtifactEvent,
  ControlEvent
]);

export type TBaseEvent = z.infer<typeof BaseEvent>;
export type TLifecycleEvent = z.infer<typeof LifecycleEvent>;
export type TFeatureEvent = z.infer<typeof FeatureEvent>;
export type TScenarioEvent = z.infer<typeof ScenarioEvent>;
export type TStepEvent = z.infer<typeof StepEvent>;
export type TGenericLifecycleEvent = z.infer<typeof GenericLifecycleEvent>;

export type TLogEvent = z.infer<typeof LogEvent>;
export type TArtifactEvent = z.infer<typeof ArtifactEvent>;
export type TImageArtifact = z.infer<typeof ImageArtifact>;
export type TVideoArtifact = z.infer<typeof VideoArtifact>;
export type TVideoStartArtifact = z.infer<typeof VideoStartArtifact>;
export type THtmlArtifact = z.infer<typeof HtmlArtifact>;
export type TSpeechArtifact = z.infer<typeof SpeechArtifact>;
export type TJsonArtifact = z.infer<typeof JsonArtifact>;
export type TMermaidArtifact = z.infer<typeof MermaidArtifact>;
export type THttpTraceArtifact = z.infer<typeof HttpTraceArtifact>;
export type TResolvedFeaturesArtifact = z.infer<typeof ResolvedFeaturesArtifact>;
export type TFileArtifact = z.infer<typeof FileArtifact>;
export type TControlEvent = z.infer<typeof ControlEvent>;
export type THaibunEvent = z.infer<typeof HaibunEvent>;

