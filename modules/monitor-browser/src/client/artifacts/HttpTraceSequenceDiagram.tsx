import React, { useMemo, useRef, useEffect } from 'react';
import { THttpTraceArtifact } from '@haibun/core/schema/protocol.js';
import { MermaidArtifact } from './MermaidArtifact';

interface HttpTraceSequenceDiagramProps {
  traces: THttpTraceArtifact[];
  currentTime?: number;
  startTime?: number;
}

/**
 * Generates a mermaid sequence diagram from http-trace artifacts.
 * Shows request/response flow between browser and servers.
 * Highlights the current request based on timeline position.
 */
export function HttpTraceSequenceDiagram({ traces, currentTime, startTime = 0 }: HttpTraceSequenceDiagramProps) {
  const { mermaidSource, currentTraceIndex } = useMemo(() => {
    if (traces.length === 0) {
      return { mermaidSource: '', currentTraceIndex: -1 };
    }

    // Group traces by request/response pairs
    // Each request should be followed by its response
    const participants = new Set<string>();
    participants.add('Browser');

    // Extract unique server hosts
    traces.forEach(trace => {
      if (trace.trace.requestingURL) {
        try {
          const url = new URL(trace.trace.requestingURL);
          participants.add(url.hostname || 'Server');
        } catch {
          participants.add('Server');
        }
      }
    });

    // Build sequence diagram
    let source = 'sequenceDiagram\n';

    // Add participants
    source += '  participant Browser\n';
    participants.forEach(p => {
      if (p !== 'Browser') {
        source += `  participant ${sanitizeParticipant(p)}\n`;
      }
    });

    // Find current trace based on timeline position
    let currentIdx = -1;
    if (currentTime !== undefined) {
      const currentAbsoluteTime = startTime + currentTime;
      for (let i = traces.length - 1; i >= 0; i--) {
        if (traces[i].timestamp <= currentAbsoluteTime) {
          currentIdx = i;
          break;
        }
      }
    }

    // Add messages for each trace
    traces.forEach((trace, idx) => {
      const isActive = idx <= currentIdx;
      const isCurrent = idx === currentIdx;
      const host = getHost(trace.trace.requestingURL || trace.trace.requestingPage);
      const sanitizedHost = sanitizeParticipant(host);

      if (trace.httpEvent === 'request' || trace.httpEvent === 'route') {
        const method = trace.trace.method || 'GET';
        const path = getPath(trace.trace.requestingURL);
        const label = `${method} ${path}`;

        if (isCurrent) {
          source += `  rect rgb(14, 116, 144)\n`;
        }

        if (isActive) {
          source += `  Browser->>${sanitizedHost}: ${escapeLabel(label)}\n`;
        } else {
          source += `  Browser-->>${sanitizedHost}: ${escapeLabel(label)}\n`;
        }

        if (isCurrent) {
          source += `  end\n`;
        }
      } else if (trace.httpEvent === 'response') {
        const status = trace.trace.status || 200;
        const label = `${status} ${trace.trace.statusText || ''}`;

        if (isCurrent) {
          source += `  rect rgb(14, 116, 144)\n`;
        }

        if (isActive) {
          source += `  ${sanitizedHost}-->>Browser: ${escapeLabel(label)}\n`;
        } else {
          source += `  ${sanitizedHost}-->Browser: ${escapeLabel(label)}\n`;
        }

        if (isCurrent) {
          source += `  end\n`;
        }
      }
    });

    return { mermaidSource: source, currentTraceIndex: currentIdx };
  }, [traces, currentTime, startTime]);

  if (!mermaidSource || traces.length === 0) {
    return <div className="text-slate-500 text-sm">No HTTP traces available</div>;
  }

  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted rect into view when currentTraceIndex changes
  useEffect(() => {
    if (currentTraceIndex < 0 || !containerRef.current) return;

    // Small delay to allow mermaid to render
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      // Find the rect element with the highlight color (rgb(14, 116, 144) = teal/cyan)
      const rects = containerRef.current.querySelectorAll('rect');
      for (const rect of rects) {
        const fill = rect.getAttribute('fill');
        // Mermaid may render as rgb() or hex
        if (fill && (fill.includes('14, 116, 144') || fill === '#0e7490' || fill.toLowerCase() === 'rgb(14,116,144)' || fill.toLowerCase() === 'rgb(14, 116, 144)')) {
          rect.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          break;
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentTraceIndex, mermaidSource]);

  return (
    <div className="http-trace-sequence" ref={containerRef}>
      <MermaidArtifact
        artifact={{
          artifactType: 'mermaid',
          source: mermaidSource,
          id: 'http-trace-sequence',
          timestamp: Date.now(),
          kind: 'artifact',
          mimetype: 'text/x-mermaid'
        } as any}
      />
      <div className="text-xs text-slate-400 mt-2 font-mono">
        {currentTraceIndex >= 0 ? (
          <span>Showing {currentTraceIndex + 1} of {traces.length} HTTP events</span>
        ) : (
          <span>{traces.length} HTTP events</span>
        )}
      </div>
    </div>
  );
}

// Helper functions
function sanitizeParticipant(name: string): string {
  // Mermaid participant names must be alphanumeric
  return name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
}

function getHost(url: string | undefined): string {
  if (!url) return 'Server';
  try {
    const parsed = new URL(url);
    return parsed.hostname || 'Server';
  } catch {
    return 'Server';
  }
}

function getPath(url: string | undefined): string {
  if (!url) return '/';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '/';
    // Truncate long paths
    return path.length > 30 ? path.substring(0, 27) + '...' : path;
  } catch {
    return '/';
  }
}

function escapeLabel(label: string): string {
  // Escape characters that could break mermaid syntax
  return label.replace(/["\n\r]/g, ' ').substring(0, 50);
}

/**
 * Generate mermaid sequence diagram source from http-trace artifacts
 */
export function generateSequenceDiagramFromTraces(traces: THttpTraceArtifact[]): string {
  if (traces.length === 0) return '';

  const participants = new Set<string>();
  participants.add('Browser');

  traces.forEach(trace => {
    const host = getHost(trace.trace.requestingURL || trace.trace.requestingPage);
    participants.add(host);
  });

  let source = 'sequenceDiagram\n';
  source += '  participant Browser\n';
  participants.forEach(p => {
    if (p !== 'Browser') {
      source += `  participant ${sanitizeParticipant(p)}\n`;
    }
  });

  traces.forEach(trace => {
    const host = getHost(trace.trace.requestingURL || trace.trace.requestingPage);
    const sanitizedHost = sanitizeParticipant(host);

    if (trace.httpEvent === 'request' || trace.httpEvent === 'route') {
      const method = trace.trace.method || 'GET';
      const path = getPath(trace.trace.requestingURL);
      source += `  Browser->>${sanitizedHost}: ${escapeLabel(`${method} ${path}`)}\n`;
    } else if (trace.httpEvent === 'response') {
      const status = trace.trace.status || 200;
      source += `  ${sanitizedHost}-->>Browser: ${escapeLabel(`${status} ${trace.trace.statusText || ''}`)}\n`;
    }
  });

  return source;
}
