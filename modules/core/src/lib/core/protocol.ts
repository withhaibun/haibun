import { z } from 'zod';

export const ExecutionIntentSchema = z.object({
  mode: z.enum(['authoritative', 'speculative', 'prose']).default('authoritative'),
  usage: z.enum(['testing', 'debugging', 'background', 'polling']).optional(),
  stepperOptions: z.record(z.any()).optional(),
});

export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

export const FlowSignalSchema = z.object({
  kind: z.enum(['ok', 'fail', 'retry', 'skip']),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
  payload: z.any().optional(),
});

export type FlowSignal = z.infer<typeof FlowSignalSchema>;

export const SystemMessageSchema = z.object({
  topic: z.string().optional(),
  signal: FlowSignalSchema,
  intent: ExecutionIntentSchema,
});

export type SystemMessage = z.infer<typeof SystemMessageSchema>;
