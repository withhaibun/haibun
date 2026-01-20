/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

// Mock mermaid as it requires browser APIs
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>Mock Diagram</svg>' }),
  }
}));

describe('ArtifactRenderer', () => {
  it('exports ArtifactRenderer component', async () => {
    const { ArtifactRenderer } = await import('./ArtifactRenderer');
    expect(ArtifactRenderer).toBeDefined();
    expect(typeof ArtifactRenderer).toBe('function');
  });

  it('exports ImageArtifact component', async () => {
    const { ImageArtifact } = await import('./ImageArtifact');
    expect(ImageArtifact).toBeDefined();
    expect(typeof ImageArtifact).toBe('function');
  });

  it('exports VideoArtifact component', async () => {
    const { VideoArtifact } = await import('./VideoArtifact');
    expect(VideoArtifact).toBeDefined();
    expect(typeof VideoArtifact).toBe('function');
  });

  it('exports HtmlArtifact component', async () => {
    const { HtmlArtifact } = await import('./HtmlArtifact');
    expect(HtmlArtifact).toBeDefined();
    expect(typeof HtmlArtifact).toBe('function');
  });

  it('exports SpeechArtifact component', async () => {
    const { SpeechArtifact } = await import('./SpeechArtifact');
    expect(SpeechArtifact).toBeDefined();
    expect(typeof SpeechArtifact).toBe('function');
  });

  it('exports JsonArtifact component', async () => {
    const { JsonArtifact } = await import('./JsonArtifact');
    expect(JsonArtifact).toBeDefined();
    expect(typeof JsonArtifact).toBe('function');
  });

  it('exports MermaidArtifact component', async () => {
    const { MermaidArtifact } = await import('./MermaidArtifact');
    expect(MermaidArtifact).toBeDefined();
    expect(typeof MermaidArtifact).toBe('function');
  });
});
