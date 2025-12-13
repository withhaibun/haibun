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

// Artifact Events
export const ArtifactEvent = BaseEvent.extend({
  kind: z.literal('artifact'),
  artifactType: z.enum(['video', 'image', 'html', 'json', 'file', 'network-trace', 'terminal']),
  mimetype: z.string(),
  path: z.string().optional(),

  // Metadata for the UI
  isTimeLined: z.boolean().default(false),
  duration: z.number().optional(),
});

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
export type TControlEvent = z.infer<typeof ControlEvent>;
export type THaibunEvent = z.infer<typeof HaibunEvent>;
