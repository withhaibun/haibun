import React from 'react';
import { TArtifactEvent } from '@haibun/core/schema/protocol.js';
import { ArtifactRenderer } from '../artifacts';
import { VSCodeLink } from './VSCodeLink';

type ArtifactRowProps = {
    e: TArtifactEvent;
    isExpanded: boolean;
    onToggle: () => void;
    isSerializedMode: boolean;
    currentTime: number;
    videoStartTimestamp: number | null;
    videoMetadata: { duration: number; width: number; height: number; } | null;
};

export const ArtifactRow = ({ e, isExpanded, onToggle, isSerializedMode, currentTime, videoStartTimestamp, videoMetadata }: ArtifactRowProps) => {
    const [short, full] = (e.emitter || '').split('|');
    const display = short || e.emitter;
    
    return (
        <div className="w-full max-w-full">
            <button
                onClick={(ev) => {
                    ev.stopPropagation();
                    onToggle();
                }}
                className="w-full text-left py-0.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-2"
            >
                <span className="text-[10px] w-4 text-center">{isExpanded ? '▼' : '▶'}</span>
                <span className="font-mono">📎 {e.artifactType}</span>
                {'path' in e && <span className="text-slate-500 truncate">- {e.path}</span>}
                {display && (
                    <span className="ml-auto text-[9px] text-slate-400 px-2 shrink-0 italic">
                        {!isSerializedMode && full 
                            ? <VSCodeLink path={full}>{display}</VSCodeLink> 
                            : display}
                    </span>
                )}
            </button>
            {isExpanded && (
                <div className="p-2 mt-1 border border-slate-700 rounded bg-slate-900/50">
                    <ArtifactRenderer artifact={e} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} videoMetadata={videoMetadata} />
                </div>
            )}
        </div>
    );
};
