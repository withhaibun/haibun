import React from 'react';
import { THaibunEvent, TArtifactEvent } from '@haibun/core/schema/protocol.js';
import { ArtifactRenderer } from '../artifacts';

type InlineArtifactsProps = {
    e: THaibunEvent;
    expandedArtifacts: Set<string>;
    toggleArtifact: (id: string) => void;
    currentTime: number;
    videoStartTimestamp: number | null;
    videoMetadata: { duration: number; width: number; height: number; } | null;
};

export const InlineArtifacts = ({ e, expandedArtifacts, toggleArtifact, currentTime, videoStartTimestamp, videoMetadata }: InlineArtifactsProps) => {
    let embeddedArtifacts: any[] | undefined = undefined;
    
    if (e.kind === 'log') {
        embeddedArtifacts = e.attributes?.artifacts as any[];
    } else if (e.kind === 'lifecycle') {
        embeddedArtifacts = ('topics' in e && e.topics) ? (e.topics as Record<string, unknown>).artifacts as TArtifactEvent[] : undefined;
    }
    
    if (!embeddedArtifacts || !Array.isArray(embeddedArtifacts) || embeddedArtifacts.length === 0) {
        return null;
    }
    
    return (
        <div className="ml-20 my-1 space-y-1">
            {embeddedArtifacts.map((artifact: any, idx: number) => {
                const artifactId = `${e.id}.artifact.${idx}`;
                const isExpanded = expandedArtifacts.has(artifactId);
                const artifactEvent: TArtifactEvent = {
                    id: artifactId,
                    timestamp: e.timestamp,
                    source: 'haibun',
                    kind: 'artifact',
                    artifactType: artifact.artifactType,
                    mimetype: artifact.mimetype || 'application/octet-stream',
                    ...('path' in artifact && { path: artifact.path }),
                    ...('json' in artifact && { json: artifact.json }),
                    ...('transcript' in artifact && { transcript: artifact.transcript }),
                    ...('resolvedFeatures' in artifact && { resolvedFeatures: artifact.resolvedFeatures }),
                } as TArtifactEvent;
                return (
                    <div key={artifactId} className="border border-slate-700 rounded bg-slate-900/50">
                        <button
                            onClick={() => toggleArtifact(artifactId)}
                            className="w-full text-left px-2 py-1 text-xs text-slate-400 hover:bg-slate-800/50 flex items-center gap-1"
                        >
                            <span>{isExpanded ? '▼' : '▶'}</span>
                            <span>📎 {artifact.artifactType}</span>
                            {'path' in artifact && <span className="text-slate-500 truncate">- {artifact.path}</span>}
                        </button>
                        {isExpanded && (
                            <div className="p-2 border-t border-slate-700">
                                <ArtifactRenderer artifact={artifactEvent} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} videoMetadata={videoMetadata} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
