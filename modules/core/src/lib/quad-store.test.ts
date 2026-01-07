
import { QuadStore } from './quad-store.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('QuadStore Contexts', () => {
  let store: QuadStore;

  beforeEach(() => {
    store = new QuadStore();
  });

  it('should store and retrieve quads with default context', () => {
    store.add({ subject: 's', predicate: 'p', object: 'o', context: 'default' });
    const results = store.query({ subject: 's' });
    expect(results).toHaveLength(1);
    expect(results[0].context).toBe('default');
  });

  it('should store and retrieve quads with arbitrary context', () => {
    store.add({ subject: 's', predicate: 'p', object: 'o', context: 'trust-registry' });
    const results = store.query({ context: 'trust-registry' });
    expect(results).toHaveLength(1);
    expect(results[0].context).toBe('trust-registry');
  });

  it('should isolate contexts', () => {
    store.add({ subject: 's', predicate: 'p', object: 'o1', context: 'A' });
    store.add({ subject: 's', predicate: 'p', object: 'o2', context: 'B' });

    const resultsA = store.query({ context: 'A' });
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0].object).toBe('o1');

    const resultsB = store.query({ context: 'B' });
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].object).toBe('o2');
  });

  it('should query across contexts if context not specified', () => {
    store.add({ subject: 's', predicate: 'p', object: 'o1', context: 'A' });
    store.add({ subject: 's', predicate: 'p', object: 'o2', context: 'B' });

    const results = store.query({ subject: 's' });
    expect(results).toHaveLength(2);
  });

  it('should clear specific context', () => {
    store.add({ subject: 's', predicate: 'p', object: 'o1', context: 'A' });
    store.add({ subject: 's', predicate: 'p', object: 'o2', context: 'B' });

    store.clear('A');
    expect(store.query({ context: 'A' })).toHaveLength(0);
    expect(store.query({ context: 'B' })).toHaveLength(1);
  });
});
