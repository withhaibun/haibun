import React from 'react';
import { TImageArtifact } from '@haibun/core/schema/protocol.js';
import { getArtifactUrl } from '../lib/utils';

interface ImageArtifactProps {
  artifact: TImageArtifact;
}

export function ImageArtifact({ artifact }: ImageArtifactProps) {
  return (
    <div className="haibun-artifact-image">
      <img
        src={getArtifactUrl(artifact.path)}
        alt="Screen capture artifact"
        className="max-w-full h-auto rounded shadow-md"
        loading="lazy"
      />
    </div>
  );
}
