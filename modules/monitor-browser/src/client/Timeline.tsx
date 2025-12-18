
import React, { useState, useEffect, useMemo } from 'react';
import { THaibunEvent } from './types';

interface TimelineProps {
    min: number;
    max: number;
    current: number;
    onChange: (val: number) => void;
    isPlaying: boolean;
    onPlayPause: () => void;
    events?: THaibunEvent[];
    startTime?: number;
    playbackSpeed: number;
    onSpeedChange: (speed: number) => void;
}

// Helper to get symbol and color for event
const getNotchStyle = (event: THaibunEvent): { color: string, icon: string } => {
    if (event.kind === 'lifecycle') {
        if (event.type === 'feature') return { color: '#c084fc', icon: '📄' }; // Purple
        if (event.type === 'scenario') return { color: '#60a5fa', icon: '📋' }; // Blue
        if (event.type === 'step') {
            if (event.status === 'running') return { color: '#eab308', icon: '⏳' }; // Yellow
            if (event.status === 'failed') return { color: '#ef4444', icon: '❌' }; // Red - CHECK_NO
            if (event.status === 'completed') return { color: '#22c55e', icon: '✅' }; // Green - CHECK_YES
            return { color: '#94a3b8', icon: '•' }; // Slate dot
        }
    }
    if (event.kind === 'log') {
        if (event.level === 'error') return { color: '#ef4444', icon: '🚨' };
        if (event.level === 'warn') return { color: '#eab308', icon: '⚠️' };
        if (event.level === 'info') return { color: '#3b82f6', icon: 'ℹ️' };
        return { color: '#94a3b8', icon: '•' };
    }
    if (event.kind === 'artifact') return { color: '#10b981', icon: '📎' }; // Emerald

    return { color: '#94a3b8', icon: '•' };
};

// Speed options: 0.02 (labeled -50x), 0.05 (labeled -20x), 1, 2
const SPEED_OPTIONS = [0.02, 0.05, 1, 2];

export function Timeline({
    min, max, current, onChange, isPlaying, onPlayPause,
    events = [], startTime = 0, playbackSpeed, onSpeedChange
}: TimelineProps) {
    const [localValue, setLocalValue] = useState(current);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) {
            setLocalValue(current);
        }
    }, [current, isDragging]);

    // Calculate notch positions for all step events
    const notches = useMemo(() => {
        if (max === 0 || events.length === 0) return [];

        return events
            .filter(e => {
                // Always show High Priority items
                const isError = e.kind === 'log' && e.level === 'error' || (e.kind === 'lifecycle' && e.status === 'failed');
                const isWarn = e.kind === 'log' && e.level === 'warn';
                const isArtifact = e.kind === 'artifact';
                const isStructure = e.kind === 'lifecycle' && (e.type === 'feature' || e.type === 'scenario');

                if (isError || isWarn || isArtifact || isStructure) return true;

                // For normal steps, show COMPLETED (end) events instead of start events to show ✅ instead of ⏳
                if (e.kind === 'lifecycle' && e.type === 'step' && e.stage === 'end') {
                    // Filter out technical steps if needed, though 'end' events might not always have labels populated identically? 
                    // Usually they do.
                    const isTechnical = /^[a-z]/.test(e.in || '');
                    return !isTechnical;
                }

                return false;
            })
            .map(e => {
                const relativeTime = e.timestamp - startTime;
                const percentage = max > 0 ? (relativeTime / max) * 100 : 0;
                const style = getNotchStyle(e);

                return {
                    id: e.id,
                    time: relativeTime,
                    percentage: Math.max(0, Math.min(100, percentage)),
                    color: style.color,
                    icon: style.icon,
                    label: e.kind === 'lifecycle' ? (e as any).in : e.kind
                };
            });
    }, [events, startTime, max]);

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        setLocalValue(val);
        onChange(val);
    };

    const handleMouseDown = () => setIsDragging(true);
    const handleMouseUp = () => setIsDragging(false);

    const handleRestart = () => onChange(min);

    const formatTime = (ms: number) => (ms / 1000).toFixed(2) + 's';

    const formatSpeed = (speed: number) => {
        if (speed === 0.02) return '-50×';
        if (speed === 0.05) return '-20×';
        return `${speed}×`;
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border px-4 py-2 flex items-center gap-3 z-50 bg-background">
            {/* Restart button */}
            <button
                onClick={handleRestart}
                title="Restart"
                className="bg-transparent border-none cursor-pointer text-lg px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
            >
                ⏮
            </button>

            {/* Play/Pause button */}
            <button
                onClick={onPlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
                className="bg-transparent border-none cursor-pointer text-lg px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
            >
                {isPlaying ? '⏸️' : '▶️'}
            </button>

            {/* Speed selector */}
            <select
                value={playbackSpeed}
                onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                title="Playback Speed"
                className="bg-background text-foreground text-xs border border-border rounded px-1"
            >
                {SPEED_OPTIONS.map(speed => (
                    <option key={speed} value={speed}>
                        {formatSpeed(speed)}
                    </option>
                ))}
            </select>

            {/* Slider container */}
            <div className="flex-1 relative h-6 flex items-center">
                {/* Notches layer */}
                <div className="absolute inset-0 pointer-events-none z-0">
                    {notches.map((notch, idx) => (
                        <div
                            key={`${notch.id}-${idx}`}
                            title={`${notch.label} (${formatTime(notch.time)})`}
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm leading-none select-none opacity-50"
                            style={{
                                left: `${notch.percentage}%`,
                                color: notch.color,
                                zIndex: notch.icon === '•' ? 0 : 1
                            }}
                        >
                            {notch.icon}
                        </div>
                    ))}
                </div>

                {/* Native range slider */}
                <input
                    type="range"
                    id="haibun-time-slider"
                    min={min}
                    max={max || 1}
                    value={localValue}
                    onChange={handleSliderChange}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onTouchStart={handleMouseDown}
                    onTouchEnd={handleMouseUp}
                    className="w-full cursor-pointer relative z-[2] m-0 h-full bg-transparent opacity-80"
                />
            </div>

            {/* Time display */}
            <span className="font-mono text-sm font-semibold text-muted-foreground min-w-[130px] text-right">
                {formatTime(localValue)} / {formatTime(max)}
            </span>

            {/* End button */}
            <button
                onClick={() => onChange(max)}
                title="Go to end"
                className="bg-transparent border-none cursor-pointer text-lg px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
            >
                ⏭
            </button>
        </div>
    );
}
