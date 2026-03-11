import { describe, it, expect } from 'vitest';
import { generateSequenceDiagramFromTraces } from './HttpTraceSequenceDiagram';
import { THttpTraceArtifact } from '@haibun/core/schema/protocol.js';

const createTrace = (
  httpEvent: 'request' | 'response' | 'route',
  overrides: Partial<THttpTraceArtifact['trace']> = {},
  timestamp = Date.now()
): THttpTraceArtifact => ({
  id: `http-trace-${timestamp}`,
  timestamp,
  kind: 'artifact',
  artifactType: 'http-trace',
  httpEvent,
  source: 'PlaywrightEvents',
  level: 'debug',
  trace: {
    requestingPage: 'http://localhost:3000/',
    requestingURL: 'http://api.example.com/data',
    method: 'GET',
    headers: {},
    ...overrides,
  },
  mimetype: 'application/json',
});

describe('generateSequenceDiagramFromTraces', () => {
  it('returns empty string for empty traces', () => {
    expect(generateSequenceDiagramFromTraces([])).toBe('');
  });

  it('generates basic sequence diagram with request', () => {
    const traces = [
      createTrace('request', { method: 'GET', requestingURL: 'http://api.example.com/users' }),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    expect(result).toContain('sequenceDiagram');
    expect(result).toContain('participant Browser');
    expect(result).toContain('api_example_com');
    expect(result).toContain('GET /users');
  });

  it('generates sequence diagram with request and response', () => {
    const traces = [
      createTrace('request', { method: 'POST', requestingURL: 'http://api.example.com/login' }, 1000),
      createTrace('response', { status: 200, statusText: 'OK', requestingURL: 'http://api.example.com/login' }, 1100),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    expect(result).toContain('POST /login');
    expect(result).toContain('200 OK');
    expect(result).toContain('-->>Browser');
  });

  it('handles multiple servers', () => {
    const traces = [
      createTrace('request', { requestingURL: 'http://api.example.com/data' }),
      createTrace('request', { requestingURL: 'http://cdn.example.com/image.png' }),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    expect(result).toContain('api_example_com');
    expect(result).toContain('cdn_example_com');
  });

  it('handles route events as requests', () => {
    const traces = [
      createTrace('route', { method: 'GET', requestingURL: 'http://api.example.com/resource' }),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    expect(result).toContain('Browser->>');
    expect(result).toContain('GET /resource');
  });

  it('truncates long paths', () => {
    const traces = [
      createTrace('request', {
        requestingURL: 'http://api.example.com/very/long/path/that/exceeds/the/limit/for/display'
      }),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    expect(result).toContain('...');
  });

  it('sanitizes participant names', () => {
    const traces = [
      createTrace('request', { requestingURL: 'http://api-v2.example.com:8080/test' }),
    ];

    const result = generateSequenceDiagramFromTraces(traces);

    // Should only contain alphanumeric and underscores
    expect(result).toMatch(/participant [a-zA-Z0-9_]+/);
  });
});
