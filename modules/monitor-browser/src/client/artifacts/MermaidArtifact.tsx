import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TMermaidArtifact } from '../types';
import mermaid from 'mermaid';

interface MermaidArtifactProps {
  artifact: TMermaidArtifact;
}

// Initialize mermaid globally
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'neutral',
  maxTextSize: 100000,
});

/**
 * Mermaid diagram artifact with zoom controls.
 */
export function MermaidArtifact({ artifact }: MermaidArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 3)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.25)), []);
  const resetZoom = useCallback(() => setScale(1), []);

  useEffect(() => {
    if (!containerRef.current || !artifact.source) return;

    const render = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg } = await mermaid.render(id, artifact.source);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
        setError(null);
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    render();
  }, [artifact.source]);

  return (
    <div className="haibun-artifact-mermaid">
      {/* Zoom Controls */}
      <div className="flex gap-1 mb-2">
        <button
          onClick={zoomOut}
          className="px-2 py-0.5 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100 font-medium"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="px-2 py-0.5 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100 font-medium"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="px-2 py-0.5 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100 font-medium"
        >
          +
        </button>
      </div>

      {/* SVG Container */}
      <div
        className="overflow-auto max-h-[600px] border border-gray-200 rounded p-2 bg-white"
        style={{ maxWidth: '100%' }}
      >
        {error ? (
          <div className="text-red-500 text-sm p-2">
            Error rendering diagram: {error}
            <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
              {artifact.source}
            </pre>
          </div>
        ) : (
          <div
            ref={containerRef}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          />
        )}
      </div>
    </div>
  );
}
