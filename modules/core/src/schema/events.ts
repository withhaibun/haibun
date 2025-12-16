import { z } from 'zod';

// Base Protocol
export const BaseEvent = z.object({
  id: z.string().describe('Unique identifier for the event, typically the seqPath'),
  timestamp: z.number().int().describe('Absolute epoch timestamp in milliseconds'),
  source: z.string().default('haibun').describe('Source of the event'),
});

// Lifecycle Events
export const LifecycleEvent = BaseEvent.extend({
  kind: z.literal('lifecycle'),
  type: z.enum(['feature', 'scenario', 'step', 'activity', 'waypoint', 'ensure', 'execution']),
  stage: z.enum(['start', 'end']),

  // Reference info
  stepperName: z.string().optional(),
  actionName: z.string().optional(),
  label: z.string().optional(),

  // Execution Context
  status: z.enum(['running', 'completed', 'failed', 'skipped']).optional(),
  error: z.string().optional(),

  // Execution Intent
  intent: z.object({
    mode: z.enum(['speculative', 'authoritative']).optional()
  }).optional(),
});

// Log Events
export const LogEvent = BaseEvent.extend({
  kind: z.literal('log'),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(), // Interactive inspector data
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
  duration: z.number().optional(),
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

export const ResolvedFeaturesArtifact = BaseArtifact.extend({
  artifactType: z.literal('resolvedFeatures'),
  resolvedFeatures: z.array(z.unknown()),
  index: z.number().optional(),
  mimetype: z.string().default('application/json'),
});

// Generic file artifact for other types
export const FileArtifact = BaseArtifact.extend({
  artifactType: z.literal('file'),
  path: z.string(),
  mimetype: z.string(),
});

// Artifact discriminated union
export const ArtifactEvent = z.discriminatedUnion('artifactType', [
  ImageArtifact,
  VideoArtifact,
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
  signal: z.enum(['graph-link', 'break', 'pause', 'resume']),
  payload: z.record(z.string(), z.unknown()),
});

// Union Type
export const HaibunEvent = z.discriminatedUnion('kind', [
  LifecycleEvent,
  LogEvent,
  ArtifactEvent,
  ControlEvent
]);

export type TBaseEvent = z.infer<typeof BaseEvent>;
export type TLifecycleEvent = z.infer<typeof LifecycleEvent>;
export type TLogEvent = z.infer<typeof LogEvent>;
export type TArtifactEvent = z.infer<typeof ArtifactEvent>;
export type TImageArtifact = z.infer<typeof ImageArtifact>;
export type TVideoArtifact = z.infer<typeof VideoArtifact>;
export type THtmlArtifact = z.infer<typeof HtmlArtifact>;
export type TSpeechArtifact = z.infer<typeof SpeechArtifact>;
export type TJsonArtifact = z.infer<typeof JsonArtifact>;
export type TMermaidArtifact = z.infer<typeof MermaidArtifact>;
export type THttpTraceArtifact = z.infer<typeof HttpTraceArtifact>;
export type TResolvedFeaturesArtifact = z.infer<typeof ResolvedFeaturesArtifact>;
export type TFileArtifact = z.infer<typeof FileArtifact>;
export type TControlEvent = z.infer<typeof ControlEvent>;
export type THaibunEvent = z.infer<typeof HaibunEvent>;

