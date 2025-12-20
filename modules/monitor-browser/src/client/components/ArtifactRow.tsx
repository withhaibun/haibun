import React from 'react';
import { TArtifactEvent } from '@haibun/core/schema/protocol.js';
import { VSCodeLink } from './VSCodeLink';

type ArtifactRowProps = {
    e: TArtifactEvent;
    onSelect: () => void;
    isSerializedMode: boolean;
    isSelected?: boolean;
};

export const ArtifactRow = ({ e, onSelect, isSerializedMode, isSelected }: ArtifactRowProps) => {
    const [short, full] = (e.emitter || '').split('|');
    const display = short || e.emitter;

    return (
        <div className="w-full max-w-full">
            <button
                onClick={(ev) => {
                    ev.stopPropagation();
                    onSelect();
                }}
                className={`w-full text-left py-0.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-2 ${isSelected ? 'text-cyan-400' : ''}`}
            >
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
        </div>
    );
};
