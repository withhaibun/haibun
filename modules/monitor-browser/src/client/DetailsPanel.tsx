import React, { useState, useEffect, useRef } from 'react';
import { THaibunEvent, TArtifactEvent, THttpTraceArtifact } from '@haibun/core/schema/protocol.js';
import { JsonArtifact } from './artifacts/JsonArtifact';
import { ArtifactRenderer } from './artifacts';
import { HttpTraceSequenceDiagram } from './artifacts/HttpTraceSequenceDiagram';
import { QuadGraphDiagram } from './artifacts/QuadGraphDiagram';
import { SourceLinks } from './components/SourceLinks';
import { TEST_IDS } from '../test-ids';

import { Debugger } from './Debugger';

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
  cwd: string | null;
  isSerializedMode: boolean;
  viewOrder?: ('sequence' | 'quad')[];
  // biome-ignore lint/suspicious/noExplicitAny: prompt type
  activePrompt?: any;
  onDebugSubmit?: (value: string) => void;
}

export function DetailsPanel({ event, onClose, width, onWidthChange, currentTime, videoStartTimestamp, videoMetadata, isPlaying, startTime, cwd, isSerializedMode, viewOrder = [], activePrompt, onDebugSubmit }: DetailsPanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizing) return;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const maxWidth = window.innerWidth * 0.85;
      onWidthChange(Math.max(250, Math.min(maxWidth, newWidth)));
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

  // Enforce max width constraint on mount and window resize
  useEffect(() => {
    const checkWidth = () => {
      const maxWidth = window.innerWidth * 0.85;
      if (width > maxWidth) {
        onWidthChange(maxWidth);
      }
    };

    // Check immediately
    checkWidth();

    // Check on resize
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [width, onWidthChange]);

  if (!event) return null;

  const isArtifact = event.kind === 'artifact';


  // Check if this is a synthetic event (e.g. created for graph views)
  // biome-ignore lint/suspicious/noExplicitAny: synthetic event props
  const allTraces = (event as any)._allTraces;
  // biome-ignore lint/suspicious/noExplicitAny: synthetic event props
  const isQuadGraphEvent = (event as any)._isQuadGraph;
  // biome-ignore lint/suspicious/noExplicitAny: synthetic event props
  const quadJson = (event as any).json?.quadstore;


  // Format timestamp as full date and time
  const formattedDateTime = new Date(event.timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });

  // Determine header text - Always use formatted date/time as requested
  const headerText = formattedDateTime;

  // Prepare JSON View Data
  const jsonViewData = allTraces ? { traceCount: allTraces.length, traces: allTraces } :
    quadJson ? { quadCount: quadJson.length, quads: quadJson } :
      event;

  // biome-ignore lint/suspicious/noExplicitAny: complex object construction
  const jsonArtifact = { artifactType: 'json', json: jsonViewData } as any;

  // biome-ignore lint/suspicious/noExplicitAny: synthetic properties
  const tracesData = (event as any)._allTraces as THttpTraceArtifact[] | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: synthetic properties
  const quadsData = (event as any).json?.quadstore ?? (event as any)._quads; // support both _quads or json.quadstore

  const hasViews = (viewOrder.includes('sequence') && tracesData) || (viewOrder.includes('quad') && quadsData);

  return (
    <div
      ref={panelRef}
      style={{ width: `${width}px` }}
      className="border-l-4 border-l-cyan-500 bg-slate-900 flex flex-col fixed right-0 top-14 bottom-12 shadow-xl z-40"
      data-testid={TEST_IDS.APP.DETAILS_PANEL}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-cyan-500/50 active:bg-cyan-500 group z-50"
        onMouseDown={() => setIsResizing(true)}
        data-testid={TEST_IDS.DETAILS.RESIZE_HANDLE}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-600 group-hover:bg-cyan-500" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyan-700 bg-cyan-900/30 shrink-0" data-testid={TEST_IDS.DETAILS.HEADER}>
        <button
          onClick={() => {
            const el = document.getElementById(`event-${event.id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer hover:underline truncate"
          title={`Go to event ${event.id}`}
        >
          {headerText}
        </button>
        <div className="flex-1 flex justify-end mr-4">
          <SourceLinks
            featurePath={event.kind === 'lifecycle' && 'featurePath' in event ? event.featurePath : undefined}
            lineNumber={event.kind === 'lifecycle' && 'lineNumber' in event ? event.lineNumber : undefined}
            emitter={event.emitter}
            cwd={cwd}
            isSerializedMode={isSerializedMode}
            isBackground={!!(event.kind === 'lifecycle' && 'featurePath' in event && event.featurePath?.includes('/backgrounds/'))}
            isWaypoint={event.kind === 'lifecycle' && (event.type === 'ensure' || event.type === 'activity')}
          />
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white transition-colors text-sm leading-none px-2 py-1 hover:bg-slate-700 rounded"
          data-testid={TEST_IDS.DETAILS.CLOSE_BUTTON}
        >
          ✕
        </button>
      </div>

      {/* Content Main Container - No global scroll, sections scroll independently */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-900">

        {/* 0. Debugger - Has Priority if active */}
        {activePrompt && onDebugSubmit && (
          <div className="shrink-0 border-b border-slate-700 p-4 bg-slate-800/30 min-h-[200px]" data-testid={TEST_IDS.DEBUGGER.ROOT}>
            <div className="text-xs font-bold text-cyan-400 mb-2 flex items-center gap-2">
              <span className="animate-pulse">●</span> Debugger Active
            </div>
            <div className="relative h-full">
              <Debugger prompt={activePrompt} onSubmit={onDebugSubmit} className="border-0 shadow-none bg-transparent p-0 w-full static" />
            </div>
          </div>
        )}

        {/* 1. Raw Source (JSON) - Always First */}
        <div className="shrink-0 p-4 border-b border-slate-700 max-h-[40%] overflow-auto" data-testid={TEST_IDS.DETAILS.RAW_SOURCE}>
          <div className="text-xs font-bold text-slate-500 mb-1 opacity-50">Event Source</div>
          <JsonArtifact artifact={jsonArtifact} collapsed={true} />
        </div>

        {/* 2. Standard Artifact Renderer (Images, Videos etc) - If applicable */}
        {isArtifact && !allTraces && !isQuadGraphEvent && (
          <div className="shrink-0 border-b border-slate-700 p-4 max-h-[30%] overflow-auto" data-testid={TEST_IDS.DETAILS.ARTIFACT_RENDERER}>
            <ArtifactRenderer
              artifact={event as TArtifactEvent}
              currentTime={currentTime}
              videoStartTimestamp={videoStartTimestamp}
              videoMetadata={videoMetadata}
              startTime={startTime}
            />
          </div>
        )}

        {/* 3. Graph Views - Take Remaining Height */}
        {hasViews && (
          <div className={`flex-1 min-h-0 flex ${width > 900 ? 'flex-row' : 'flex-col'} gap-0`} data-testid={TEST_IDS.DETAILS.GRAPH_VIEWS}>
            {viewOrder.map(view => {
              const isSideBySide = width > 900 && viewOrder.includes('sequence') && viewOrder.includes('quad');

              if (view === 'sequence' && tracesData) {
                return (
                  <div
                    key="sequence"
                    className={`flex flex-col ${width > 900
                      ? isSideBySide ? 'w-[30%] min-w-[300px]' : 'flex-1'
                      : 'h-1/2' /* Split vertical height if stacked? Or flex-1? User asked for 100% remaining. If stacked, they share it. */
                      } border-r border-slate-700 last:border-r-0`}
                    data-testid={TEST_IDS.DETAILS.SEQUENCE_VIEW}
                  >
                    <div className="flex-1 overflow-hidden relative">
                      <HttpTraceSequenceDiagram
                        traces={tracesData}
                        currentTime={currentTime}
                        startTime={startTime}
                      />
                    </div>
                  </div>
                );
              }
              if (view === 'quad' && quadsData) {
                return (
                  <div
                    key="quad"
                    className={`flex flex-col ${width > 900 ? 'flex-1 min-w-0' : 'h-1/2'
                      }`}
                    data-testid={TEST_IDS.DETAILS.QUAD_VIEW}
                  >
                    <div className="flex-1 overflow-hidden relative">
                      <QuadGraphDiagram
                        quads={quadsData}
                        currentTime={currentTime}
                        startTime={startTime || 0}
                      />
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
