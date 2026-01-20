/**
 * QuadStore Types for Core
 * 
 * Minimal quad types for the unified observation model.
 */

export interface TQuad {
  subject: string;
  predicate: string;
  object: unknown;
  namedGraph: string;
  timestamp: number;
}

export interface TQuadPattern {
  subject?: string;
  predicate?: string;
  object?: unknown;
  namedGraph?: string;
}

export interface IQuadStore {
  /** Add a quad to the store */
  add(quad: Omit<TQuad, 'timestamp'>): void;

  /** Query quads matching a pattern */
  query(pattern: TQuadPattern): TQuad[];

  /** Select the most recent value for a subject-predicate pair */
  select(subject: string, predicate: string): unknown | undefined;

  /** Clear quads, optionally filtered by namedGraph */
  clear(namedGraph?: string): void;

  /** Remove quads matching a pattern */
  remove(pattern: TQuadPattern): void;

  /** Get all quads */
  all(): TQuad[];
}
