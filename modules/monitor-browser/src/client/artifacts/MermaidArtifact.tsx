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
  const [loading, setLoading] = useState<boolean>(false);

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
      setLoading(true);
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
        })
        .finally(() => {
          setLoading(false);
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
          <>
            {loading && (
              <div className="flex items-center justify-center p-4">
                <svg className="animate-spin h-5 w-5 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
            <div
              ref={containerRef}
              className={loading ? 'hidden' : ''}
              style={{
                transformOrigin: '0 0',
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
