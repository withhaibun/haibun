/**
 * QuadStore - In-memory quad store for observations
 * 
 * Stores observations as Subject-Predicate-Object-namedGraph quads with timestamps.
 * This is the unified data model for all shared state in Haibun.
 */

import { IQuadStore, TQuad, TQuadPattern } from './quad-types.js';

export class QuadStore implements IQuadStore {
  private quads: TQuad[] = [];

  add(quad: Omit<TQuad, 'timestamp'>): void {
    this.quads.push({
      ...quad,
      timestamp: Date.now(),
    });
  }

  query(pattern: TQuadPattern): TQuad[] {
    return this.quads.filter(q => {
      if (pattern.subject !== undefined && q.subject !== pattern.subject) return false;
      if (pattern.predicate !== undefined && q.predicate !== pattern.predicate) return false;
      if (pattern.object !== undefined && q.object !== pattern.object) return false;
      if (pattern.namedGraph !== undefined && q.namedGraph !== pattern.namedGraph) return false;
      return true;
    });
  }

  select(subject: string, predicate: string): unknown | undefined {
    const matches = this.query({ subject, predicate });
    if (matches.length === 0) return undefined;
    // Return most recent
    return matches[matches.length - 1].object;
  }

  clear(namedGraph?: string): void {
    if (namedGraph) {
      this.quads = this.quads.filter(q => q.namedGraph !== namedGraph);
    } else {
      this.quads = [];
    }
  }

  remove(pattern: TQuadPattern): void {
    this.quads = this.quads.filter(q => {
      if (pattern.subject !== undefined && q.subject !== pattern.subject) return true;
      if (pattern.predicate !== undefined && q.predicate !== pattern.predicate) return true;
      if (pattern.object !== undefined && q.object !== pattern.object) return true;
      if (pattern.namedGraph !== undefined && q.namedGraph !== pattern.namedGraph) return true;
      return false; // Match found, filter it out
    });
  }

  all(): TQuad[] {
    return [...this.quads];
  }
}
