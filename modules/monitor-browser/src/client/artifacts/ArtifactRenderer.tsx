import React from 'react';
import { TArtifactEvent } from '../types';
import { ImageArtifact } from './ImageArtifact';
import { VideoArtifact } from './VideoArtifact';
import { HtmlArtifact } from './HtmlArtifact';
import { SpeechArtifact } from './SpeechArtifact';
import { JsonArtifact } from './JsonArtifact';
import { MermaidArtifact } from './MermaidArtifact';

import { getMermaidFromResolvedFeatures } from '../lib/mermaid';

interface ArtifactRendererProps {
  artifact: TArtifactEvent;
  currentTime?: number;
  onTimeSync?: (time: number) => void;
}

export function ArtifactRenderer({ artifact, currentTime, onTimeSync }: ArtifactRendererProps) {
  switch (artifact.artifactType) {
    case 'image':
      return <ImageArtifact artifact={artifact} />;
    case 'video':
      return <VideoArtifact artifact={artifact} currentTime={currentTime} onTimeSync={onTimeSync} />;
    case 'html':
      return <HtmlArtifact artifact={artifact} />;
    case 'speech':
      return <SpeechArtifact artifact={artifact} />;
    case 'json':
      return <JsonArtifact artifact={artifact} />;
    case 'mermaid':
      return <MermaidArtifact artifact={artifact} />;
    case 'resolvedFeatures':
      return <MermaidArtifact artifact={{ ...artifact, artifactType: 'mermaid', source: getMermaidFromResolvedFeatures(artifact.resolvedFeatures || []) } as any} />;
    case 'http-trace':
      return <JsonArtifact artifact={{ ...artifact, artifactType: 'json', json: artifact.trace } as any} />;
    case 'file':
      return (
        <a href={artifact.path} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          📎 {artifact.path}
        </a>
      );
    default:
      return <div className="text-gray-500 text-xs">Unknown artifact type</div>;
  }
}
