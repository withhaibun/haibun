import React, { useRef, useEffect } from 'react';
import { TVideoArtifact } from '../types';

interface VideoArtifactProps {
  artifact: TVideoArtifact;
  currentTime?: number;
  onTimeSync?: (time: number) => void;
}

/**
 * Timeline-bound video artifact.
 * - Displays translucent in top-right corner
 * - Expands on hover (scale 2x)
 * - Syncs with global timeline (no individual controls)
 */
export function VideoArtifact({ artifact, currentTime, onTimeSync }: VideoArtifactProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync video with global timeline
  useEffect(() => {
    if (videoRef.current && currentTime !== undefined && artifact.isTimeLined) {
      // Calculate video time based on artifact start and current timeline position
      const videoTime = currentTime / 1000; // Convert ms to seconds
      if (Math.abs(videoRef.current.currentTime - videoTime) > 0.5) {
        videoRef.current.currentTime = videoTime;
      }
    }
  }, [currentTime, artifact.isTimeLined]);

  return (
    <div className="haibun-artifact-video fixed top-4 right-6 z-50 pointer-events-none">
      <video
        ref={videoRef}
        src={artifact.path}
        className="max-w-[320px] h-auto block transition-all duration-300 ease-in-out
                   origin-top-right pointer-events-auto shadow-lg bg-white opacity-70
                   hover:scale-[2] hover:opacity-100 hover:shadow-2xl"
        muted
        playsInline
      />
    </div>
  );
}
