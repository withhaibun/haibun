import React, { useState, useRef, useEffect } from 'react';
import { getArtifactUrl } from '../lib/artifactUrl';

interface VideoMetadata {
    duration: number;
    width: number;
    height: number;
}

interface FloatingVideoPlayerProps {
    path: string;
    startTimestamp: number;
    appStartTime: number;
    currentTime: number;
    onMetadataLoaded?: (metadata: VideoMetadata) => void;
}

/**
 * Floating video player that syncs with the timeline.
 * - Appears when currentTime reaches startTimestamp
 * - Syncs video playback to timeline position
 * - Extracts and reports metadata (dimensions, duration)
 */
export function FloatingVideoPlayer({
    path,
    startTimestamp,
    appStartTime,
    currentTime,
    onMetadataLoaded,
}: FloatingVideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [metadata, setMetadata] = useState<VideoMetadata | null>(null);

    // Calculate if we should show the video
    const videoOffset = startTimestamp - appStartTime;
    const shouldShow = currentTime >= videoOffset;

    // Sync video to timeline
    useEffect(() => {
        if (videoRef.current && shouldShow) {
            const videoTime = (currentTime - videoOffset) / 1000;
            if (videoTime >= 0 && Math.abs(videoRef.current.currentTime - videoTime) > 0.5) {
                videoRef.current.currentTime = Math.max(0, videoTime);
            }
        }
    }, [currentTime, videoOffset, shouldShow]);

    const handleMetadataLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = e.currentTarget;
        const newMetadata = {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
        };
        setMetadata(newMetadata);
        onMetadataLoaded?.(newMetadata);
    };

    if (!shouldShow) return null;

    return (
        <div className="fixed top-20 right-6 z-50 pointer-events-none">
            <video
                ref={videoRef}
                src={getArtifactUrl(path)}
                onLoadedMetadata={handleMetadataLoaded}
                className="max-w-[320px] h-auto block transition-all duration-300 ease-in-out
                           origin-top-right pointer-events-auto shadow-lg bg-black opacity-70
                           hover:scale-[2] hover:opacity-100 hover:shadow-2xl"
                muted
                playsInline
            />
        </div>
    );
}

/**
 * Format video metadata for display
 */
export function formatVideoMetadata(metadata: VideoMetadata | null): string {
    if (!metadata) return '';
    const duration = metadata.duration.toFixed(1);
    return `${metadata.width}×${metadata.height}, ${duration}s`;
}
