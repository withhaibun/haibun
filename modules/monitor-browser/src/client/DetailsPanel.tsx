import React, { useState, useEffect, useRef } from 'react';
import { THaibunEvent, TArtifactEvent, THttpTraceArtifact } from '@haibun/core/schema/protocol.js';
import { JsonArtifact } from './artifacts/JsonArtifact';
import { ArtifactRenderer } from './artifacts';
import { HttpTraceSequenceDiagram } from './artifacts/HttpTraceSequenceDiagram';

interface DetailsPanelProps {
  event: THaibunEvent | null;
  onClose: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  currentTime?: number;
  videoStartTimestamp?: number | null;
  videoMetadata?: { duration: number; width: number; height: number } | null;
  isPlaying?: boolean;
  startTime?: number;
}

export function DetailsPanel({ event, onClose, width, onWidthChange, currentTime, videoStartTimestamp, videoMetadata, isPlaying, startTime }: DetailsPanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizing) return;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      onWidthChange(Math.max(250, Math.min(800, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, onWidthChange]);

  if (!event) return null;

  const isArtifact = event.kind === 'artifact';
  const isHttpTrace = isArtifact && (event as TArtifactEvent).artifactType === 'http-trace';

  // Check if this is a synthetic event with all traces attached
  const allTraces = (event as any)._allTraces as THttpTraceArtifact[] | undefined;

  // Determine header text
  const headerText = isHttpTrace && allTraces
    ? `HTTP Traces (${allTraces.length})`
    : event.id;

  return (
    <div
      ref={panelRef}
      style={{ width: `${width}px` }}
      className="border-l-4 border-l-cyan-500 bg-slate-900 flex flex-col fixed right-0 top-14 bottom-12 shadow-xl z-40"
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-cyan-500/50 active:bg-cyan-500 group"
        onMouseDown={() => setIsResizing(true)}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-600 group-hover:bg-cyan-500" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyan-700 bg-cyan-900/30 shrink-0">
        <button
          onClick={() => {
            const el = document.getElementById(`event-${event.id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer hover:underline truncate"
          title={event.id}
        >
          {headerText}
        </button>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white transition-colors text-sm leading-none px-2 py-1 hover:bg-slate-700 rounded"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* HTTP Trace Sequence Diagram */}
        {isHttpTrace && allTraces && (
          <div className="border-b border-slate-700 p-4">
            <HttpTraceSequenceDiagram
              traces={allTraces}
              currentTime={currentTime}
              startTime={startTime}
            />
          </div>
        )}

        {/* Regular artifact renderer (non-http-trace or single http-trace) */}
        {isArtifact && !allTraces && (
          <div className="border-b border-slate-700 p-4">
            <ArtifactRenderer
              artifact={event as TArtifactEvent}
              currentTime={currentTime}
              videoStartTimestamp={videoStartTimestamp}
              videoMetadata={videoMetadata}
              startTime={startTime}
            />
          </div>
        )}

        {/* JSON view */}
        <div className="p-4 pb-8">
          <JsonArtifact artifact={{ artifactType: 'json', json: allTraces ? { traceCount: allTraces.length, firstTrace: allTraces[0] } : event } as any} />
        </div>
      </div>
    </div>
  );
}
