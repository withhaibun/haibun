import React from 'react';
import { THaibunEvent, LifecycleEvent } from '@haibun/core/schema/protocol.js';
import { JsonArtifact } from './artifacts/JsonArtifact';

interface DetailsPanelProps {
  event: THaibunEvent | null;
  onClose: () => void;
}

export function DetailsPanel({ event, onClose }: DetailsPanelProps) {
  if (!event) return null;

  return (
    <div className="w-[400px] border-l border-slate-700 bg-slate-900 flex flex-col fixed right-0 top-12 bottom-0 shadow-xl z-50">
      <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Event Details</h2>
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors text-xl leading-none p-1"
        >
          ✕
        </button>
      </div>
      
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        <div>
          <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">ID</label>
          <button 
            onClick={() => {
              const el = document.getElementById(`event-${event.id}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            className="font-mono text-xs text-blue-400 hover:text-blue-300 cursor-pointer underline"
          >
            {event.id}
          </button>
        </div>

        <div className="flex-1">
          <JsonArtifact artifact={{ artifactType: 'json', json: event } as any} />
        </div>
      </div>
    </div>
  );
}
