import React, { useRef, useEffect } from 'react';
import { TVideoArtifact } from '@haibun/core/schema/protocol.js';
import { getArtifactUrl } from '../lib/utils';

interface VideoArtifactProps {
  artifact: TVideoArtifact;
  currentTime?: number;
  videoStartTimestamp?: number | null;
  startTime?: number;
  sync?: boolean;
}

/**
 * Standard video artifact display.
 * - Used inline in the log/document
 * - Can sync with timeline (seeks to match currentTime relative to videoStartTimestamp)
 * 
 * Time calculations:
 * - startTime: first event's absolute timestamp (e.g., 1734567890000)
 * - currentTime: timeline position in ms relative to startTime (e.g., 5000 = 5s into timeline)
 * - videoStartTimestamp: absolute timestamp when video recording started
 * 
 * Video position = currentTime - (videoStartTimestamp - startTime)
 *                = how far into the video we should be
 */
export function VideoArtifact({ artifact, currentTime, videoStartTimestamp, startTime, sync = false }: VideoArtifactProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Calculate video time relative to when recording started
  const getVideoTime = () => {
    // Need all values to calculate
    if (currentTime === undefined || videoStartTimestamp === undefined || videoStartTimestamp === null || startTime === undefined || startTime === null) {
      return null;
    }
    // Video started at this point on the timeline (ms from timeline start)
    const videoStartOnTimeline = videoStartTimestamp - startTime;
    // How far into the video we should be (ms)
    const videoTimeMs = currentTime - videoStartOnTimeline;
    // Convert to seconds, clamp to 0
    return Math.max(0, videoTimeMs / 1000);
  };

  const videoTime = getVideoTime();

  // Sync video position with global timeline
  useEffect(() => {
    if (!sync || !videoRef.current || videoTime === null) return;

    // Only seek if difference is significant (avoid constant micro-seeks)
    if (Math.abs(videoRef.current.currentTime - videoTime) > 0.1) {
      videoRef.current.currentTime = videoTime;
    }
  }, [videoTime, sync]);

  const formatTime = (seconds: number) => seconds.toFixed(2) + 's';

  // Calculate useful debug info
  const getDebugInfo = () => {
    if (startTime === undefined || startTime === null) return 'Missing startTime';
    if (videoStartTimestamp === undefined || videoStartTimestamp === null) return 'Missing videoStartTimestamp';
    if (currentTime === undefined) return 'Missing currentTime';

    const videoStartOnTimeline = (videoStartTimestamp - startTime) / 1000;
    return `Recording started at ${videoStartOnTimeline.toFixed(1)}s on timeline`;
  };

  return (
    <div className="haibun-artifact-video w-full max-w-2xl my-2">
      <video
        ref={videoRef}
        src={getArtifactUrl(artifact.path)}
        className="w-full h-auto rounded border border-slate-700 shadow-sm block bg-black"
        controls={!sync}
        muted
        playsInline
      />
      {sync && (
        <div className="text-xs text-slate-500 mt-1 font-mono">
          {videoTime !== null ? (
            <span>Video: {formatTime(videoTime)}</span>
          ) : (
            <span className="text-orange-400">{getDebugInfo()}</span>
          )}
        </div>
      )}
    </div>
  );
}
