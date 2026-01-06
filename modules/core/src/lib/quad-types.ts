/**
 * QuadStore Types for Core
 * 
 * Minimal quad types for the unified observation model.
 */

export interface TQuad {
  subject: string;
  predicate: string;
  object: unknown;
  context: string;
  timestamp: number;
}

export interface TQuadPattern {
  subject?: string;
  predicate?: string;
  object?: unknown;
  context?: string;
}

export interface IQuadStore {
  /** Add a quad to the store */
  add(quad: Omit<TQuad, 'timestamp'>): void;

  /** Query quads matching a pattern */
  query(pattern: TQuadPattern): TQuad[];

  /** Select the most recent value for a subject-predicate pair */
  select(subject: string, predicate: string): unknown | undefined;

  /** Clear quads, optionally filtered by context */
  clear(context?: string): void;

  /** Get all quads */
  all(): TQuad[];
}
