import React from 'react';
import { buildVSCodeUri } from '../lib/vscode';

type VSCodeLinkProps = {
    path: string;
    lineNumber?: number;
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
};

export const VSCodeLink = ({ path, lineNumber, children, className = '', onClick }: VSCodeLinkProps) => (
    <a 
        href={buildVSCodeUri(path, lineNumber)}
        className={`hover:text-cyan-400 decoration-dotted underline-offset-2 ${className}`}
        onClick={onClick}
    >
        {children}
    </a>
);
