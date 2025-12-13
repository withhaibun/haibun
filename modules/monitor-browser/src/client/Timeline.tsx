
import React, { useState, useEffect } from 'react';
import { Slider } from './components/ui/slider';
import { Button } from './components/ui/button';
import { Play, Pause, ChevronFirst, ChevronLast } from 'lucide-react';

interface TimelineProps {
    min: number;
    max: number;
    current: number;
    onChange: (val: number) => void;
    isPlaying: boolean;
    onPlayPause: () => void;
}

export function Timeline({ min, max, current, onChange, isPlaying, onPlayPause }: TimelineProps) {
    // Local state for smooth dragging
    const [localValue, setLocalValue] = useState(current);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) {
            setLocalValue(current);
        }
    }, [current, isDragging]);

    const handleValueChange = (vals: number[]) => {
        setLocalValue(vals[0]);
        onChange(vals[0]);
    };

    const handleCommit = (vals: number[]) => {
        setIsDragging(false);
        onChange(vals[0]);
    };

    const formatTime = (ms: number) => (ms / 1000).toFixed(2) + 's';

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t p-4 flex flex-col gap-2 z-50">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => onChange(min)}>
                    <ChevronFirst className="h-4 w-4" />
                </Button>
                
                <Button variant="outline" size="icon" onClick={onPlayPause}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>

                <div className="flex-1">
                    <Slider
                        min={min}
                        max={max}
                        step={100} // 100ms granules
                        value={[localValue]}
                        onValueChange={(vals) => {
                            setIsDragging(true);
                            handleValueChange(vals);
                        }}
                        onValueCommit={handleCommit}
                    />
                </div>

                <div className="font-mono text-sm w-20 text-right">
                    {formatTime(localValue)}
                </div>

                <Button variant="ghost" size="icon" onClick={() => onChange(max)}>
                    <ChevronLast className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
