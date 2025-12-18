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
    <div className="w-[400px] border-l border-slate-700 bg-slate-900 flex flex-col h-full fixed right-0 top-0 bottom-0 shadow-xl z-10 transition-transform duration-300">
      <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800">
        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Event Details</h2>
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
      
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div>
          <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">ID</label>
          <div className="font-mono text-xs text-slate-300 select-all">{event.id}</div>
        </div>

        {event.kind === 'lifecycle' && event.type === 'step' && (
          <>
            <div className="flex gap-2">
                 <div className="bg-slate-800 p-2 rounded flex-1">
                  <span className="text-slate-500 text-[10px] block uppercase font-bold">Stepper</span>
                  <span className="text-purple-300 text-xs font-mono">{event.stepperName}</span>
                </div>
            </div>

            {event.stepValuesMap && (
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Step Values (Introspection)</label>
                <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
                    <JsonArtifact artifact={{ artifactType: 'json', json: event.stepValuesMap } as any} />
                </div>
              </div>
            )}
            
            {event.stepArgs && (
               <div className="mt-4">
                <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Step Arguments</label>
                <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
                    <JsonArtifact artifact={{ artifactType: 'json', json: event.stepArgs } as any} />
                </div>
              </div>
            )}

            {event.topics && (
               <div className="mt-4">
                <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Step Result (Topics)</label>
                <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
                    <JsonArtifact artifact={{ artifactType: 'json', json: event.topics } as any} />
                </div>
              </div>
            )}
          </>
        )}

        {event.kind === 'log' && event.attributes && (
           <div className="mt-4">
            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Log Attributes</label>
            <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
                <JsonArtifact artifact={{ artifactType: 'json', json: event.attributes } as any} />
            </div>
          </div>
        )}

        {event.kind === 'control' && event.args && (
           <div className="mt-4">
            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Control Arguments</label>
            <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
                <JsonArtifact artifact={{ artifactType: 'json', json: event.args } as any} />
            </div>
          </div>
        )}
        
        <div>
           <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Raw Event</label>
           <div className="bg-slate-800 rounded border border-slate-700 overflow-hidden">
              <JsonArtifact artifact={{ artifactType: 'json', json: event } as any} />
           </div>
        </div>
      </div>
    </div>
  );
}
