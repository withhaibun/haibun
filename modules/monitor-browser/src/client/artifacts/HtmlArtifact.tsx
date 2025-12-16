import React from 'react';
import { THtmlArtifact } from '../types';

interface HtmlArtifactProps {
  artifact: THtmlArtifact;
}

/**
 * HTML artifact displayed in an iframe.
 * Used for accessibility reports and other HTML content.
 */
export function HtmlArtifact({ artifact }: HtmlArtifactProps) {
  return (
    <div className="haibun-artifact-html flex flex-col gap-1">
      <div className="text-[10px] text-slate-500 flex justify-end px-1">
        <a href={artifact.path} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-blue-500">
          Open {artifact.path.split('/').pop()} ↗
        </a>
      </div>
      <iframe
        src={artifact.path}
        className="w-full h-[80vh] border-none rounded shadow-md bg-white"
        title="HTML Artifact"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
