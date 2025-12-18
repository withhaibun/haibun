import React from 'react';
import { TArtifactEvent } from '../types';
import { ImageArtifact } from './ImageArtifact';
import { VideoArtifact } from './VideoArtifact';
import { HtmlArtifact } from './HtmlArtifact';
import { SpeechArtifact } from './SpeechArtifact';
import { JsonArtifact } from './JsonArtifact';
import { MermaidArtifact } from './MermaidArtifact';

import { getMermaidFromResolvedFeatures } from '../lib/mermaid';
import { getArtifactUrl } from '../lib/artifactUrl';
import { formatVideoMetadata } from './FloatingVideoPlayer';

interface ArtifactRendererProps {
  artifact: TArtifactEvent;
  currentTime?: number;
  videoStartTimestamp?: number | null;
  videoMetadata?: { duration: number; width: number; height: number } | null;
  displayMode?: 'log' | 'document';
  onTimeSync?: (time: number) => void;
}

export function ArtifactRenderer({ artifact, currentTime, videoStartTimestamp, videoMetadata, displayMode = 'log', onTimeSync }: ArtifactRendererProps) {
  switch (artifact.artifactType) {
    case 'image':
      return <ImageArtifact artifact={artifact} />;
    case 'video':
      // In document mode, show the video inline with controls
      if (displayMode === 'document') {
        return <VideoArtifact artifact={artifact} />;
      }
      
      // In log mode, video is rendered by the floating player when videoStartTimestamp is set
      // Show just metadata inline
      if (videoStartTimestamp !== null && videoStartTimestamp !== undefined) {
        const metadataStr = formatVideoMetadata(videoMetadata || null);
        return (
          <div className="text-slate-600 text-xs italic">
            {metadataStr ? <span>{metadataStr}</span> : <span>Synced to timeline</span>}
          </div>
        );
      }
      return <VideoArtifact artifact={artifact} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} sync={true} />;
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
        <a href={getArtifactUrl(artifact.path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          📎 {artifact.path}
        </a>
      );
    case 'video-start':
      return <div className="text-slate-500 text-[10px] font-mono italic">Video capture start</div>;
    default:
      return <div className="text-gray-500 text-xs">Unknown artifact type</div>;
  }
}
