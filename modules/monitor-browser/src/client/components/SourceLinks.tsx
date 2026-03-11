import React from 'react';
import { VSCodeLink } from './VSCodeLink';

type SourceLinksProps = {
    featurePath?: string;
    lineNumber?: number;
    emitter?: string;
    cwd: string | null;
    isSerializedMode: boolean;
    isBackground: boolean;
    isWaypoint: boolean;
};

export const SourceLinks = ({ featurePath, lineNumber, emitter, cwd, isSerializedMode, isBackground, isWaypoint }: SourceLinksProps) => {
    const [short, full] = (emitter || '').split('|');
    const emitterDisplay = short || emitter;
    
    const featureFile = featurePath ? featurePath.split('/').pop() : null;
    const sourcePrefix = isBackground ? '⬚ ' : isWaypoint ? '◈ ' : '';
    const hasFeatureLink = !isSerializedMode && featurePath && lineNumber && cwd;
    const hasEmitter = !!emitterDisplay;
    
    if (!hasFeatureLink && !hasEmitter) return null;
    
    const absolutePath = featurePath && cwd 
        ? (featurePath.startsWith('/') ? `${cwd}${featurePath}` : `${cwd}/${featurePath}`)
        : undefined;
    
    return (
        <span className="ml-auto text-[9px] text-slate-400 px-2 shrink-0 italic flex flex-col items-end">
            {hasFeatureLink && absolutePath && (
                <VSCodeLink 
                    path={absolutePath} 
                    lineNumber={lineNumber}
                    onClick={(ev) => ev.stopPropagation()}
                >
                    {sourcePrefix}{featureFile}:{lineNumber}
                </VSCodeLink>
            )}
            {hasEmitter && (
                !isSerializedMode && full 
                    ? <VSCodeLink path={full}>{emitterDisplay}</VSCodeLink> 
                    : <span>{emitterDisplay}</span>
            )}
        </span>
    );
};
