import React from 'react';
import { THaibunEvent, TLifecycleEvent, TStepEvent } from '@haibun/core/schema/protocol.js';

type EventIdDisplayProps = {
    e: TLifecycleEvent | TStepEvent | THaibunEvent;
};

export const EventIdDisplay = ({ e }: EventIdDisplayProps) => {
    const segments = e.id?.split('.') || [];
    const isProper = segments.length > 0 && segments.every((s: string) => /^\d+$/.test(s));
    let type = e.kind as string;
    
    if (e.kind === 'lifecycle') {
        type = e.type;
        if (e.type === 'step') {
            const actionName = 'actionName' in e ? e.actionName : '';
            return <div>{e.id}<br />{actionName}</div>;
        }
    } else if (e.kind === 'artifact') {
        type = e.artifactType;
    }
    
    if (isProper && segments.length >= 2) return <>{e.id} {type}</>;
    return <>{type}</>;
};
