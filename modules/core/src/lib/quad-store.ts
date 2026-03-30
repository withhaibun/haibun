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

  // --- Vertex operations: convenience over quads ---
  // namedGraph = vertex label, subject = vertex id

  private idFields: Record<string, string> = {};
  private schemas: Record<string, import('zod').ZodType> = {};

  /** Register a vertex type for schema validation and identity resolution. */
  registerVertexType(label: string, schema: import('zod').ZodType, idField: string): void {
    this.schemas[label] = schema;
    this.idFields[label] = idField;
  }

  async upsertVertex(label: string, data: unknown): Promise<string> {
    const schema = this.schemas[label];
    const validated = (schema ? schema.parse(data) : data) as Record<string, unknown>;
    const idField = this.idFields[label] ?? 'id';
    const id = String(validated[idField]);
    if (!id) throw new Error(`Missing identity field "${idField}" for ${label}`);
    this.remove({ subject: id, namedGraph: label });
    for (const [key, value] of Object.entries(validated)) {
      if (value !== undefined && value !== null) {
        this.add({ subject: id, predicate: key, object: value, namedGraph: label });
      }
    }
    return id;
  }

  async getVertex<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
    const quads = this.query({ subject: id, namedGraph: label });
    if (quads.length === 0) return undefined;
    const result: Record<string, unknown> = {};
    for (const q of quads) result[q.predicate] = q.object;
    return result as T;
  }

  async deleteVertex(label: string, id: string): Promise<void> {
    this.remove({ subject: id, namedGraph: label });
  }

  async queryVertices<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
    const allQuads = this.query({ namedGraph: label });
    const subjects = [...new Set(allQuads.map(q => q.subject))];
    let vertices: Record<string, unknown>[] = [];
    for (const subject of subjects) {
      const vertex = await this.getVertex(label, subject);
      if (vertex) vertices.push(vertex);
    }
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        vertices = vertices.filter(v => v[key] === value);
      }
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? vertices.length;
    return vertices.slice(offset, offset + limit) as T[];
  }

  async distinctPropertyValues(label: string, property: string): Promise<string[]> {
    const quads = this.query({ predicate: property, namedGraph: label });
    return [...new Set(quads.map(q => String(q.object)))].sort();
  }

  /** Build vertex type registrations from world.domains. */
  static registerVertexTypesFromDomains(store: QuadStore, domains: Record<string, { schema: import('zod').ZodType; meta?: Record<string, unknown> }>): void {
    for (const [, domain] of Object.entries(domains)) {
      const meta = domain.meta as { vertexLabel?: string; idField?: string } | undefined;
      if (meta?.vertexLabel) {
        store.registerVertexType(meta.vertexLabel, domain.schema, meta.idField ?? 'id');
      }
    }
  }
}
