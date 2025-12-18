import React, { useRef, useEffect, useState } from 'react';
import { TVideoArtifact } from '@haibun/core/schema/protocol.js';
import { getArtifactUrl } from '../lib/utils';

interface VideoArtifactProps {
  artifact: TVideoArtifact;
  currentTime?: number;
  videoStartTimestamp?: number | null;
  sync?: boolean;
}

/**
 * Standard video artifact display.
 * - Used inline in the log/document
 * - Can sync with timeline or be interactive
 */
export function VideoArtifact({ artifact, currentTime, videoStartTimestamp, sync = false }: VideoArtifactProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync video with global timeline if enabled
  useEffect(() => {
    if (sync && videoRef.current && currentTime !== undefined && videoStartTimestamp !== null) {
      const videoTime = currentTime / 1000;
      if (videoTime >= 0 && Math.abs(videoRef.current.currentTime - videoTime) > 0.5) {
        videoRef.current.currentTime = Math.max(0, videoTime);
      }
    }
  }, [currentTime, sync, videoStartTimestamp]);

  return (
    <div className="haibun-artifact-video w-full max-w-2xl my-2 group relative">
      <video
        ref={videoRef}
        src={getArtifactUrl(artifact.path)}
        className="w-full h-auto rounded border border-slate-200 shadow-sm block"
        controls={!sync}
        muted={sync}
        playsInline
      />
    </div>
  );
}


