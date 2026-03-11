import { TWorld } from './defs.js';
import { TExecutorResult } from '../schema/protocol.js';
import { AStepper } from './astepper.js';

import { z } from 'zod';

export class PhaseBailError extends Error {
  constructor(public result: TExecutorResult) {
    super('PhaseBailError');
  }
}

export class PhaseRunner {
  public steppers: AStepper[] = [];

  constructor(public world?: TWorld) { }

  public async tryPhase<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new PhaseBailError(this.createFailureResult(stage, error));
    }
  }

  public static formatError(error: unknown): string {
    return error instanceof z.ZodError
      ? error.issues.map((i: z.ZodIssue) => `  • ${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`).join('\n')
      : error instanceof Error ? error.message : String(error);
  }

  private createFailureResult(stage: string, error: unknown): TExecutorResult {
    return {
      ok: false,
      shared: this.world?.shared,
      tag: this.world?.tag,
      failure: { stage, error: { message: PhaseRunner.formatError(error), details: { stack: (error as Error)?.stack } } },
      steppers: this.steppers,
      featureResults: []
    } as unknown as TExecutorResult;
  }
}
