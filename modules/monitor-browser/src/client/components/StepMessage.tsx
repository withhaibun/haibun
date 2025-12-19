import React from 'react';
import { VSCodeLink } from './VSCodeLink';

type StepMessageProps = {
    message: string;
    canLink: boolean;
    absolutePath?: string;
    lineNumber?: number;
};

export const StepMessage = ({ message, canLink, absolutePath, lineNumber }: StepMessageProps) => {
    if (canLink && absolutePath && lineNumber) {
        return (
            <VSCodeLink 
                path={absolutePath} 
                lineNumber={lineNumber}
                className="whitespace-pre-wrap break-words hover:underline"
                onClick={(ev) => ev.stopPropagation()}
            >
                {message}
            </VSCodeLink>
        );
    }
    return <span className="whitespace-pre-wrap break-words">{message}</span>;
};
