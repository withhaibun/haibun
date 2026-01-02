import { describe, it, expect, beforeEach, vi } from 'vitest';
import WebServerStepper from './web-server-stepper.js';

const createMockWorld = () => ({
  eventLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), artifact: vi.fn() },
  runtime: {},
  moduleOptions: {},
  options: {},
  shared: { get: vi.fn(), set: vi.fn(), getJSON: vi.fn(), setJSON: vi.fn() },
  tag: { featureNum: 1 },
  domains: {},
  logger: { log: vi.fn() },
});

describe('WebServerStepper', () => {
  let stepper: WebServerStepper;

  beforeEach(() => {
    stepper = new WebServerStepper();
  });

  describe('initialization', () => {
    it('has required step definitions', () => {
      expect(stepper.steps.isListening).toBeDefined();
      expect(stepper.steps.serveFilesAt).toBeDefined();
      expect(stepper.steps.serveFiles).toBeDefined();
      expect(stepper.steps.indexFiles).toBeDefined();
      expect(stepper.steps.showRoutes).toBeDefined();
    });

    it('has port option', () => {
      expect(stepper.options.PORT).toBeDefined();
      expect(stepper.options.PORT.parse('8080').result).toBe(8080);
    });
  });

  describe('cycles', () => {
    it('creates webserver on startFeature', async () => {
      const world = createMockWorld();
      await stepper.setWorld(world as any, []);
      await stepper.cycles.startFeature!({} as any);
      expect(stepper.webserver).toBeDefined();
      expect(world.runtime['webserver']).toBe(stepper.webserver);
      await stepper.cycles.endFeature!({ shouldClose: true });
    });

    it('closes webserver on endFeature', async () => {
      const world = createMockWorld();
      await stepper.setWorld(world as any, []);
      await stepper.cycles.startFeature!({} as any);
      const ws = stepper.webserver;
      expect(ws).toBeDefined();
      await stepper.cycles.endFeature!({ shouldClose: true });
      expect(stepper.webserver).toBeUndefined();
    });
  });
});
