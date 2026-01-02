import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerHono } from './server-hono.js';
import type { IEventLogger } from '@haibun/core/lib/EventLogger.js';

const mockLogger: IEventLogger = {
  info: () => { },
  warn: () => { },
  error: () => { },
  debug: () => { },
  artifact: () => { },
};

describe('ServerHono', () => {
  let server: ServerHono;

  beforeEach(() => {
    server = new ServerHono(mockLogger, '/tmp');
  });

  afterEach(async () => {
    await server.close();
  });

  describe('constructor', () => {
    it('creates Hono app', () => {
      expect(server.app).toBeDefined();
    });
  });

  describe('addRoute', () => {
    it('adds GET route', () => {
      server.addRoute('get', '/test', c => c.text('ok'));
      expect(server.mounted.get['/test']).toBeDefined();
    });

    it('throws on duplicate route', () => {
      server.addRoute('get', '/test', c => c.text('ok'));
      expect(() => server.addRoute('get', '/test', c => c.text('ok2'))).toThrow('already mounted');
    });

    it('throws on invalid path characters', () => {
      expect(() => server.addRoute('get', '/test<script>', c => c.text('ok'))).toThrow('illegal characters');
    });

    it('allows path parameters', () => {
      server.addRoute('get', '/users/:id', c => c.text('ok'));
      expect(server.mounted.get['/users/:id']).toBeDefined();
    });
  });

  describe('addKnownRoute', () => {
    it('adds route without path validation', () => {
      server.addKnownRoute('post', '/internal', c => c.text('ok'));
      expect(server.mounted.post['/internal']).toBeDefined();
    });
  });

  describe('listen/close', () => {
    it('throws on invalid port', async () => {
      await expect(server.listen(-1)).rejects.toThrow('invalid port');
      await expect(server.listen(NaN)).rejects.toThrow('invalid port');
    });

    it('listens on dynamic port and closes', async () => {
      // Use a high port to avoid conflicts
      const dynamicPort = 10000 + Math.floor(Math.random() * 50000);
      await server.listen(dynamicPort);
      expect(server.port).toBe(dynamicPort);
      await server.close();
    });
  });

  describe('checkAddStaticFolder', () => {
    it('throws if folder missing', () => {
      expect(() => server.checkAddStaticFolder('', '/static')).toThrow('relativeFolder is required');
    });

    it('throws if mountAt missing', () => {
      expect(() => server.checkAddStaticFolder('public', '')).toThrow('mountAt is required');
    });
  });
});
