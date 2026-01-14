import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { TArtifactEvent } from '@haibun/core/schema/protocol.js';

interface MermaidArtifactProps {
  artifact: TArtifactEvent;
  containerClassName?: string;
  onRender?: (svgContainer: HTMLDivElement) => void;
  // unstyled prop to opt-out of default container styles
  unstyled?: boolean;
}

export function MermaidArtifact({ artifact, containerClassName, onRender, unstyled }: MermaidArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize mermaid configuration
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      maxTextSize: 10000000,
      maxEdges: 50000,
      htmlLabels: true,
      layout: 'elk',
    });
  }, []);

  useEffect(() => {
    if (containerRef.current && artifact.source) {
      setError(null);
      mermaid.render(`mermaid-${artifact.id}-${Date.now()}`, artifact.source)
        .then(({ svg }) => {
          if (containerRef.current) {
            containerRef.current.innerHTML = svg;
            // Ensure SVG scales correctly
            const svgElement = containerRef.current.querySelector('svg');
            if (svgElement) {
              svgElement.style.maxWidth = '100%';
              svgElement.style.height = 'auto';
            }
            if (onRender) {
              onRender(containerRef.current);
            }
          }
        })
        .catch((err) => {
          console.error('Mermaid render error:', err);
          setError(err instanceof Error ? err.message : String(err));
          if (containerRef.current) containerRef.current.innerHTML = '';
        });
    }
  }, [artifact.source, artifact.id]);

  return (
    <div className={`flex flex-col ${unstyled ? 'h-full w-full' : 'haibun-artifact-mermaid'}`}>
      {/* SVG Container */}
      <div
        className={`${unstyled ? '' : 'overflow-auto border border-gray-200 rounded p-2 bg-white'} ${containerClassName || ''} ${unstyled ? '' : 'max-h-[600px]'}`}
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
              transformOrigin: '0 0',
            }}
          />
        )}
      </div>
    </div>
  );
}
