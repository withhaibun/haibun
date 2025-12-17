
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
}

// Color mapping for different event types
const getNotchColor = (event: THaibunEvent): string => {
    if (event.kind === 'lifecycle') {
        if (event.type === 'feature') return '#3b82f6'; // blue
        if (event.type === 'scenario') return '#8b5cf6'; // purple
        if (event.type === 'step') return '#6366f1'; // indigo
    }
    if (event.kind === 'log') {
        if (event.level === 'error') return '#ef4444'; // red
        if (event.level === 'warn') return '#f59e0b'; // amber
    }
    if (event.kind === 'artifact') return '#10b981'; // emerald
    return '#94a3b8'; // slate
};

export function Timeline({ min, max, current, onChange, isPlaying, onPlayPause, events = [], startTime = 0 }: TimelineProps) {
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
                // Show lifecycle step starts (non-prose: lowercase starting)
                if (e.kind === 'lifecycle' && e.type === 'step' && e.stage === 'start') {
                    const isTechnical = /^[a-z]/.test(e.label || '');
                    return isTechnical;
                }
                // Also show artifacts
                if (e.kind === 'artifact') return true;
                return false;
            })
            .map(e => {
                const relativeTime = e.timestamp - startTime;
                const percentage = max > 0 ? (relativeTime / max) * 100 : 0;
                return { 
                    id: e.id, 
                    time: relativeTime, 
                    percentage: Math.max(0, Math.min(100, percentage)),
                    color: getNotchColor(e),
                    label: e.kind === 'lifecycle' ? (e as any).label : e.kind
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

    const atEnd = current >= max && max > 0;

    return (
        <div 
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                borderTop: '1px solid #ccc',
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                zIndex: 50,
                background: 'inherit'
            }}
        >
            {/* Restart button */}
            <button
                onClick={handleRestart}
                title="Restart"
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1em',
                    padding: '2px 6px'
                }}
            >
                ⏮
            </button>

            {/* Play/Pause button */}
            <button
                onClick={onPlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1em',
                    padding: '2px 6px'
                }}
            >
                {isPlaying ? '⏸️' : '▶️'}
            </button>

            {/* Slider container */}
            <div style={{ flex: 1, position: 'relative', height: '24px' }}>
                {/* Notches layer */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 1
                }}>
                    {notches.map((notch, idx) => (
                        <div
                            key={`${notch.id}-${idx}`}
                            title={`${notch.label} @ ${formatTime(notch.time)}`}
                            style={{
                                position: 'absolute',
                                width: '3px',
                                height: '60%',
                                top: '20%',
                                left: `${notch.percentage}%`,
                                backgroundColor: notch.color,
                                transform: 'translateX(-50%)',
                                borderRadius: '1px'
                            }}
                        />
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
                    style={{
                        width: '100%',
                        cursor: 'pointer',
                        position: 'relative',
                        zIndex: 2,
                        margin: 0,
                        accentColor: '#475569'
                    }}
                />
            </div>

            {/* Time display */}
            <span style={{
                fontFamily: 'monospace',
                fontSize: '0.75em',
                color: '#666',
                minWidth: '120px',
                textAlign: 'right'
            }}>
                {formatTime(localValue)} / {formatTime(max)}
            </span>

            {/* End button */}
            <button
                onClick={() => onChange(max)}
                title="Go to end"
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1em',
                    padding: '2px 6px'
                }}
            >
                ⏭
            </button>
        </div>
    );
}
