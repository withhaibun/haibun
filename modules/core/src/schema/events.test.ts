import { describe, it, expect } from 'vitest';
import { HaibunEvent, LifecycleEvent, LogEvent, ArtifactEvent, ControlEvent } from './events.js';

describe('Haibun Event Schemas', () => {
  it('validates a correct LifecycleEvent', () => {
    const raw = {
      id: '1.2.3',
      timestamp: 1234567890,
      kind: 'lifecycle',
      type: 'step',
      stage: 'start',
      in: 'Given I am testing',
      status: 'running',
    };
    const parsed = HaibunEvent.parse(raw);
    expect(parsed).toEqual(expect.objectContaining(raw));
    expect(parsed.kind).toBe('lifecycle');
  });

  it('validates a correct LogEvent with payload', () => {
    const raw = {
      id: '1.2.3',
      timestamp: 1234567890,
      kind: 'log',
      level: 'info',
      message: 'Processing started',
      payload: { variable: 'foo', value: 123 },
    };
    const parsed = HaibunEvent.parse(raw);
    expect(parsed).toEqual(expect.objectContaining(raw));
    expect((parsed as any).payload).toEqual({ variable: 'foo', value: 123 });
  });

  it('validates a Time-Lined ArtifactEvent', () => {
    const raw = {
      id: '1.2.3',
      timestamp: 1234567890,
      kind: 'artifact',
      artifactType: 'video',
      mimetype: 'video/mp4',
      path: '/tmp/video.mp4',
      isTimeLined: true,
      duration: 5000,
    };
    const parsed = HaibunEvent.parse(raw);
    expect(parsed).toEqual(expect.objectContaining(raw));
  });

  it('fails on invalid discriminator', () => {
    const raw = {
      id: '1',
      timestamp: 1,
      kind: 'unknown_kind', // Invalid
    };
    expect(() => HaibunEvent.parse(raw)).toThrow();
  });

  it('fails on missing required fields', () => {
    const raw = {
      id: '1',
      // timestamp missing
      kind: 'log',
      level: 'info',
      message: 'foo',
    };
    expect(() => HaibunEvent.parse(raw)).toThrow();
  });
});
