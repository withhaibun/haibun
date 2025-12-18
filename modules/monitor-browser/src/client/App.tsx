import React, { useState, useEffect, useRef, useMemo } from 'react'
import { DetailsPanel } from './DetailsPanel';
import useWebSocket, { ReadyState } from 'react-use-websocket';

import { EventFormatter } from '@haibun/core/monitor/index.js'
import { Timeline } from './Timeline'
import { Debugger } from './Debugger';
import { getInitialState } from './serialize';
import { THaibunEvent, TArtifactEvent } from '@haibun/core/schema/protocol.js';
import { DocumentView } from './DocumentView';
import { ArtifactRenderer } from './artifacts';
import { FloatingVideoPlayer } from './artifacts/FloatingVideoPlayer';

type ViewMode = 'log' | 'raw' | 'document';

function App() {

    const initialState = getInitialState();
    // If we have initial state with events, we're in serialized (offline) mode
    const isSerializedMode = !!(initialState?.events && initialState.events.length > 0);
    const [events, setEvents] = useState<THaibunEvent[]>(() => initialState?.events as THaibunEvent[] || []);
    const [connected, setConnected] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [startTime, setStartTime] = useState<number | null>(() => initialState?.startTime ?? null);
    const [maxTime, setMaxTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // View Control State
    const [viewMode, setViewMode] = useState<ViewMode>('log');
    const [minLogLevel, setMinLogLevel] = useState<string>('info');
    const [maxDepth, setMaxDepth] = useState<number>(10);
    const [expandedArtifacts, setExpandedArtifacts] = useState<Set<string>>(new Set());
    const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<THaibunEvent | null>(null);
    
    // Video metadata extracted from loadedmetadata event
    const [videoMetadata, setVideoMetadata] = useState<{
        duration: number;
        width: number;
        height: number;
    } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    const toggleArtifact = (id: string) => {
        setExpandedArtifacts(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Debugger state
    const [activePrompt, setActivePrompt] = useState<any | null>(null);

    const ws = useRef<WebSocket | null>(null);

    // Memoize WS options to prevent re-connection on render
    const wsOptions = useMemo(() => ({
        onOpen: () => {
            console.log('WS Connected');
            sendJsonMessageRef.current?.({ type: 'ready' });
        },
        onMessage: (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'event' && msg.event) {
                    setEvents(prev => [...prev, msg.event]);
                } else if (msg.type === 'prompt') {
                    console.log('Prompt received', msg);
                    setActivePrompt(msg.prompt);
                    setIsPlaying(false); // Pause on prompt
                } else if (msg.type === 'finalize') {
                    console.log('Finalize received');
                }
            } catch (e) {
                console.error('WS Parse Error', e);
            }
        },
        shouldReconnect: () => !isSerializedMode,
    }), [isSerializedMode]); // Only re-create if mode changes

    // Use a ref to access sendJsonMessage inside the memoized callback
    const sendJsonMessageRef = useRef<any>(null);

    // Only use WebSocket in live mode (not serialized)
    // Use current page host for WebSocket connection via /ws proxy path
    const wsUrl = typeof window !== 'undefined'
        ? `ws://${window.location.host}/ws`
        : null;
    const { sendJsonMessage, readyState } = useWebSocket(
        isSerializedMode ? null : wsUrl,
        wsOptions
    );

    // Keep ref updated
    sendJsonMessageRef.current = sendJsonMessage;

    useEffect(() => {
        // In serialized mode, never set connected to true
        if (isSerializedMode) {
            setConnected(false);
        } else {
            setConnected(readyState === ReadyState.OPEN);
        }
    }, [readyState, isSerializedMode]);

    // Handle Time Logic - Anchor to first event
    useEffect(() => {
        if (events.length > 0) {
            const firstEvent = events[0];
            const lastEvent = events[events.length - 1];

            if (!firstEvent?.timestamp || !lastEvent?.timestamp) return;

            if (startTime === null) {
                setStartTime(firstEvent.timestamp);
            }

            // Update max time
            const first = startTime || firstEvent.timestamp;
            const last = lastEvent.timestamp;
            const newMax = last - first;
            setMaxTime(newMax);

            // In live mode, auto-advance to show latest
            if (connected) {
                setCurrentTime(newMax);
            } else if (currentTime === 0 && newMax > 0) {
                // Initialize to end for serialized reports
                setCurrentTime(newMax);
            }
        }
    }, [events, startTime, connected]);


    // Compute video info from both video-start and video events
    // This allows us to show the video at the correct timeline position
    const videoInfo = useMemo(() => {
        const videoStartEvent = events.find(e => 
            e.kind === 'artifact' && (e as any).artifactType === 'video-start'
        );
        const videoArtifactEvent = events.find(e => 
            e.kind === 'artifact' && (e as any).artifactType === 'video'
        ) as any;
        
        if (!videoStartEvent) return null;
        
        return {
            startTimestamp: videoStartEvent.timestamp,
            path: videoArtifactEvent?.path ?? null,
        };
    }, [events]);

    const videoStartTimestamp = videoInfo?.startTimestamp ?? null;

    const handleDebugAction = (response: string) => {
        if (connected && activePrompt) {
            sendJsonMessage({
                type: 'response',
                id: activePrompt.id,
                value: response
            });
            setActivePrompt(null);
            setIsPlaying(true);
        }
    };

    const togglePlay = React.useCallback(() => {
        console.log('[Timeline] togglePlay - isPlaying:', isPlaying, 'currentTime:', currentTime, 'maxTime:', maxTime);
        // If starting play...
        if (!isPlaying && maxTime > 0) {
            // Forward loop logic
            // If at end, restart
            if (currentTime >= maxTime - 100) {
                setCurrentTime(0);
            }
        }
        // Toggle
        setIsPlaying(prev => !prev);
    }, [isPlaying, currentTime, maxTime, playbackSpeed]);

    // Playback timer - advance time when playing (works in both live and replay mode)
    useEffect(() => {
        if (!isPlaying) return;
        if (maxTime <= 0) return; // No events to play

        let lastTime = performance.now();
        let animationFrameId: number;

        const tick = (now: number) => {
            // Ensure elapsed is never negative (RAF timestamp vs performance.now safety)
            const elapsed = Math.max(0, now - lastTime);
            lastTime = now;

            setCurrentTime(prev => {
                // Delta depends on real elapsed time and playback speed
                const delta = elapsed * playbackSpeed;
                const next = prev + delta;

                // Helper to check boundaries based on direction
                const isForward = playbackSpeed > 0;

                // Handle bounds (stop only if crossing limit in direction of travel)
                if (isForward && next >= maxTime) {
                    setIsPlaying(false);
                    return maxTime;
                }
                if (!isForward && next <= 0) {
                    setIsPlaying(false);
                    return 0;
                }

                // Clamp result to valid range
                return Math.max(0, Math.min(next, maxTime));
            });

            animationFrameId = requestAnimationFrame(tick);
        };

        animationFrameId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(animationFrameId);
    }, [isPlaying, maxTime, playbackSpeed]);

    // Unified Event Processing Pipeline
    const visibleEvents = useMemo(() => {
        const effectiveStart = startTime || 0;
        
        // Stage 1: Time Filter
        const timeFiltered = events.filter(e => {
            if (!e || e.timestamp === undefined) return false;
            return (e.timestamp - effectiveStart) <= currentTime;
        });

        // Stage 2: Lifecycle Merging (Deduplication/Update-in-place)
        // We merge start/end events so only one row shows per step,
        // but we keep the start events if we have no end yet to show progress.
        const mergedEvents = timeFiltered.reduce((acc, e) => {
            if (e.kind === 'lifecycle' && e.id) {
                const existingIndex = acc.findIndex((existing: THaibunEvent) => existing.id === e.id);
                if (existingIndex !== -1) {
                    const existing = acc[existingIndex];
                    // If we have an 'end' stage, it should overwrite 'start'
                    if (existing.stage === 'start' && e.stage === 'end') {
                        const newAcc = [...acc];
                        newAcc[existingIndex] = e;
                        return newAcc;
                    }
                    // If it's the same stage, just keep the latest (shouldn't happen with seqPath)
                    if (existing.stage === e.stage) {
                         const newAcc = [...acc];
                         newAcc[existingIndex] = e;
                         return newAcc;
                    }
                }
            }
            return [...acc, e];
        }, [] as any[]);

        // Stage 3: Visibility Filter & Hidden Log Aggregation
        const levels = ['trace', 'debug', 'info', 'warn', 'error'];
        const normalizedMinLevel = minLogLevel === 'log' ? 'info' : minLogLevel;
        const minLevelIndex = levels.indexOf(normalizedMinLevel);
        
        const finalEvents: any[] = [];
        let hiddenBuffer: any[] = [];

        const flushHiddenBuffer = () => {
             if (hiddenBuffer.length > 0) {
                const bufferLevels = new Set(hiddenBuffer.map(e => e.level || 'info'));
                const sortedBufferLevels = Array.from(bufferLevels).sort((a: any, b: any) => levels.indexOf(b) - levels.indexOf(a));
                const primaryHiddenLevel = sortedBufferLevels[0] || 'info';

                const types = new Set(hiddenBuffer.map(e => {
                    if (e.kind === 'artifact') return e.artifactType;
                    if (e.kind === 'lifecycle') return e.type;
                    return e.kind;
                }));

                finalEvents.push({
                    kind: 'hidden-block',
                    count: hiddenBuffer.length,
                    level: primaryHiddenLevel,
                    types: Array.from(types),
                    id: `hidden-${Date.now()}-${finalEvents.length}`,
                    firstEventId: hiddenBuffer[0].id
                });
                hiddenBuffer = [];
            }
        };

        mergedEvents.forEach((e: THaibunEvent) => {
            let isVisible = true;
            
            // Log Level Check
            const rawLevel = e.level || 'info';
            // Treat 'log' and 'info' as the same level for filtering purposes
            const normalizedLevel = rawLevel === 'log' ? 'info' : rawLevel;
            
            const levelIndex = levels.indexOf(normalizedLevel);
            
            if (levelIndex !== -1 && minLevelIndex !== -1 && levelIndex < minLevelIndex) {
               isVisible = false;
            }

            // Depth Check
            if (isVisible && e.id) {
                const depth = e.id.split('.').length;
                if (depth > maxDepth) isVisible = false;
            }

            if (isVisible) {
                flushHiddenBuffer();
                finalEvents.push(e);
            } else {
                hiddenBuffer.push(e);
            }
        });
        
        flushHiddenBuffer();
        return finalEvents;
    }, [events, currentTime, startTime, minLogLevel, maxDepth]);

    // Auto-scroll logic
    useEffect(() => {
        if (scrollTargetId) {
            const el = document.getElementById(`event-${scrollTargetId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'start' });
                // We keep it for one more tick to be safe or just clear
                setScrollTargetId(null);
            }
        } else if (scrollRef.current && visibleEvents.length > 0 && connected && !scrollTargetId) {
            // Only auto-scroll to bottom in live mode if no specific target
            scrollRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    }, [visibleEvents.length, scrollTargetId, connected]);

    // Re-use logic for log format
    // Re-use logic for log format
    const renderLogView = () => (
        <div className="font-mono text-xs w-full bg-black p-4 rounded-lg shadow-xl overflow-hidden pb-12">
            {visibleEvents
                .map((e: THaibunEvent, i, arr) => {
                    // Handle Hidden Block
                    // e is explicitly any here because of our custom hidden-block type injection
                    if ((e as any).kind === 'hidden-block') {
                        const block = e as any;
                        const typesStr = block.types.join(', ');
                         return (
                            <div key={block.id} className="flex justify-start my-1 px-2">
                                <button
                                    onClick={() => {
                                        setMinLogLevel(block.level);
                                        setScrollTargetId(block.firstEventId);
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer transition-colors flex items-center gap-1 italic font-light tracking-wide"
                                >
                                    <span>~~~ {block.count} {typesStr} hidden at {block.level.toUpperCase()} ~~~</span>
                                </button>
                            </div>
                        );
                    }

                    // Skip null/undefined events
                    if (!e) return null;

                    const isLast = i === arr.length - 1;
                    const prevE = i > 0 ? arr[i - 1] : undefined;
                     // Ensure prevE is a standard event for formatting check (skip hidden blocks)
                    const validPrevE = prevE && (prevE as any).kind !== 'hidden-block' ? prevE : undefined;
                    const prevLevel = validPrevE ? EventFormatter.getDisplayLevel(validPrevE) : undefined;

                    const formatted = EventFormatter.formatLineElements(e, prevLevel);

                    const effectiveStart = startTime || e.timestamp;
                    const time = ((e.timestamp - effectiveStart) / 1000).toFixed(3);

                    let { showLevel, message, icon, id } = formatted;
                    // const isLifecycle = e.kind === 'lifecycle'; // unwarn
                    const depth = e.id ? e.id.split('.').length : 0;
                    const isNested = depth > 3;

                    let textClass = 'text-gray-300';
                    let bgClass = isLast ? 'bg-primary/20 border-l-2 border-primary' : 'hover:bg-gray-900 border-l-2 border-transparent';

                    // Indentation style for nested views
                    // const indentStyle = isNested ? { paddingLeft: `${(depth - 3) * 1}rem` } : {}; // unwarn

                    if (e.kind === 'lifecycle') {
                        if (e.type === 'feature') {
                            textClass = 'text-purple-400 font-bold';
                        } else if (e.type === 'scenario') {
                            textClass = 'text-blue-400 font-bold';
                        } else {
                            if (e.error) {
                                textClass = 'text-red-400';
                            } else if (e.status === 'running') {
                                textClass = 'text-yellow-500';
                                icon = '⟳';
                            }
                        }
                        if (!message) {
                            message = e.error || JSON.stringify(e.topics);
                        }
                    } else if (e.kind === 'log') {
                        if (e.level === 'error') textClass = 'text-red-500 font-bold';
                        if (e.level === 'warn') textClass = 'text-yellow-400';
                        if (!message) {
                            message = e.message || (e.attributes as Record<string, any>)?.message || JSON.stringify(e.attributes);
                        }
                    } else if (e.kind === 'control') {
                        if (!message) {
                            message = JSON.stringify(e.args);
                        }
                    }

                    // Check if this event initiates a nested block
                     // Identify next *visible* event that is not a hidden block
                     let nextEvent = undefined;
                     for(let j = i + 1; j < arr.length; j++) {
                         if ((arr[j] as any).kind !== 'hidden-block') {
                             nextEvent = arr[j];
                             break;
                         }
                     }
                    const isInstigator = nextEvent && nextEvent.id.startsWith(id + '.');

                    const prevDepth = validPrevE ? (validPrevE.id ? validPrevE.id.split('.').length : 0) : 0;
                    // Only show symbol if this row "goes deeper" than the previous one (i.e. is the first child).
                    // Sibilings (prevDepth === depth) will not have the line.
                    const showSymbol = validPrevE && prevDepth < depth;

                    return (
                        <React.Fragment key={i}>
                            <div 
                                id={`event-${e.id}`} 
                                className={`flex whitespace-pre items-stretch leading-tight transition-colors ${bgClass} cursor-pointer hover:bg-slate-800 ${selectedEvent?.id === e.id ? 'bg-slate-800 ring-1 ring-blue-500' : ''}`}
                                onClick={() => setSelectedEvent(e)}
                            >
                                <div className="w-16 flex flex-col items-end shrink-0 text-[10px] text-slate-700 dark:text-slate-400 font-medium leading-tight mr-2 self-stretch py-1">
                                    <span>{time}s</span>
                                    <span className={`text-[9px] opacity-70 ${formatted.level === 'error' ? 'text-red-500' :
                                        formatted.level === 'warn' ? 'text-yellow-500' :
                                            'text-slate-500'
                                        }`}>{formatted.level}</span>
                                </div>
                                <span className="mx-1 text-slate-800 dark:text-slate-600 self-start mt-1">｜</span>

                                <div className={`flex-1 ${textClass} break-all flex items-stretch`}>
                                    {/* Indentation Spacer */}
                                    <div style={{ width: `${Math.max(0, depth - 4) * 0.75}rem` }} className="shrink-0" />

                                    {/* Rail Container */}
                                    {(isNested || isInstigator) && (
                                        <div className="relative w-4 shrink-0 mr-1">
                                            {/* Full Line for Nested Steps */}
                                            {isNested && (
                                                <div className="absolute top-0 -bottom-[1px] right-[3px] w-px bg-indigo-500" />
                                            )}

                                            {/* Start Marker Line for Top-Level Instigators (starts from top marker down) */}
                                            {isInstigator && !isNested && (
                                                <div className="absolute top-[6px] -bottom-[1px] right-[3px] w-px bg-indigo-500" />
                                            )}

                                            {/* Horizontal Bar Symbol (Only to the Left, Top Aligned) */}
                                            {isNested && showSymbol && (
                                                <div className="absolute top-0 right-[3px] w-2.5 h-px bg-indigo-500" />
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-start gap-2 flex-1 py-1 min-w-0">
                                        {e.kind === 'artifact' ? (() => {
                                            const artifactId = e.id;
                                            const isExpanded = expandedArtifacts.has(artifactId);
                                            return (
                                                <div className="w-full max-w-full">
                                                    <button
                                                        onClick={(ev) => {
                                                            ev.stopPropagation();
                                                            toggleArtifact(artifactId);
                                                        }}
                                                        className="w-full text-left py-0.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-2"
                                                    >
                                                        <span className="text-[10px] w-4 text-center">{isExpanded ? '▼' : '▶'}</span>
                                                        <span className="font-mono">📎 {(e as TArtifactEvent).artifactType}</span>
                                                        {'path' in e && <span className="text-slate-500 truncate">- {(e as any).path}</span>}
                                                        {(() => {
                                                            const [short, full] = ((e as any).emitter || '').split('|');
                                                            const display = short || (e as any).emitter;
                                                            if (!display) return null;
                                                            return (
                                                                <span className="ml-auto text-[9px] text-slate-400 px-2 shrink-0 italic">
                                                                    {!isSerializedMode && full ? <a href={`vscode://file/${full.replace(/^file:\/\//, '')}`} className="hover:text-cyan-400 decoration-dotted underline-offset-2">{display}</a> : display}
                                                                </span>
                                                            );
                                                        })()}
                                                    </button>
                                                    {isExpanded && (
                                                        <div className="p-2 mt-1 border border-slate-700 rounded bg-slate-900/50">
                                                            <ArtifactRenderer artifact={e as TArtifactEvent} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} videoMetadata={videoMetadata} />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : (
                                            <>
                                                <span className={`inline-block w-4 text-center shrink-0 ${icon === '⟳' ? 'animate-spin' : ''}`}>{icon}</span>
                                                <span className="whitespace-pre-wrap break-words">{message}</span>
                                                {(() => {
                                                    const [short, full] = ((e as any).emitter || '').split('|');
                                                    const display = short || (e as any).emitter;
                                                    if (!display) return null;
                                                    return (
                                                        <span className="ml-auto text-[9px] text-slate-400 px-2 shrink-0 italic">
                                                            {!isSerializedMode && full ? <a href={`vscode://file/${full.replace(/^file:\/\//, '')}`} className="hover:text-cyan-400 decoration-dotted underline-offset-2">{display}</a> : display}
                                                        </span>
                                                    );
                                                })()}
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Right Column: SeqPath */}
                                <div className="w-24 text-[10px] text-slate-500 font-mono text-right ml-2 py-1 select-all hover:text-slate-300 break-words">
                                    <div title={e.id}>
                                        {(() => {
                                            const segments = e.id?.split('.') || [];
                                            const isProper = segments.length > 0 && segments.every((s: string) => /^\d+$/.test(s));
                                            let type = e.kind as string;
                                            if (e.kind === 'lifecycle') {
                                                type = e.type;
                                                if (e.type === 'step') {
                                                    const actionName = e.actionName;
                                                    return <div>{e.id}<br />{actionName}</div>;
                                                }
                                            } else if (e.kind === 'artifact') {
                                                type = e.artifactType;
                                            }
                                            if (isProper && segments.length >= 2) return `${e.id} ${type}`;
                                            return type;
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Inline Artifacts - each artifact has its own toggle */}
                            {(() => {
                                let embeddedArtifacts: any[] | undefined = undefined;
                                if (e.kind === 'log') {
                                    embeddedArtifacts = e.attributes?.artifacts as any[];
                                } else if (e.kind === 'lifecycle') {
                                    embeddedArtifacts = e.topics?.artifacts as any[];
                                }
                                if (embeddedArtifacts && Array.isArray(embeddedArtifacts) && embeddedArtifacts.length > 0) {
                                    return (
                                        <div className="ml-20 my-1 space-y-1">
                                            {embeddedArtifacts.map((artifact: any, idx: number) => {
                                                const artifactId = `${e.id}.artifact.${idx}`;
                                                const isExpanded = expandedArtifacts.has(artifactId);
                                                const artifactEvent: TArtifactEvent = {
                                                    id: artifactId,
                                                    timestamp: e.timestamp,
                                                    source: 'haibun',
                                                    kind: 'artifact',
                                                    artifactType: artifact.artifactType,
                                                    mimetype: artifact.mimetype || 'application/octet-stream',
                                                    ...('path' in artifact && { path: artifact.path }),
                                                    ...('json' in artifact && { json: artifact.json }),
                                                    ...('transcript' in artifact && { transcript: artifact.transcript }),
                                                    ...('resolvedFeatures' in artifact && { resolvedFeatures: artifact.resolvedFeatures }),
                                                } as TArtifactEvent;
                                                return (
                                                    <div key={artifactId} className="border border-slate-700 rounded bg-slate-900/50">
                                                        <button
                                                            onClick={() => toggleArtifact(artifactId)}
                                                            className="w-full text-left px-2 py-1 text-xs text-slate-400 hover:bg-slate-800/50 flex items-center gap-1"
                                                        >
                                                            <span>{isExpanded ? '▼' : '▶'}</span>
                                                            <span>📎 {artifact.artifactType}</span>
                                                            {'path' in artifact && <span className="text-slate-500 truncate">- {artifact.path}</span>}
                                                        </button>
                                                        {isExpanded && (
                                                            <div className="p-2 border-t border-slate-700">
                                                                <ArtifactRenderer artifact={artifactEvent} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} videoMetadata={videoMetadata} />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </React.Fragment>
                    );
                })}
            {/* Auto-scroll anchor */}
            <div ref={scrollRef} />
        </div>
    );

    const handleTimeChange = (val: number) => {
        setIsPlaying(false);
        setCurrentTime(val);
    };

    // Shared "Floating UI" container for Debugger or Video
    const renderFloatingUI = () => {
        // Debugger takes priority if active
        if (connected && activePrompt) {
             return (
                 <div className="w-80 shrink-0 sticky top-20 self-start z-50">
                    <div className="bg-black/90 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
                        <div className="p-2 bg-slate-800 border-b border-slate-700 font-bold text-xs text-cyan-400 flex items-center gap-2">
                             <span>⚡ Debugger Active</span>
                        </div>
                        <Debugger 
                            prompt={activePrompt}
                            onSubmit={handleDebugAction} 
                        />
                    </div>
                </div>
            );
        }

        // Otherwise show video if available
        if (videoInfo) {
            return (
                <div className="w-80 shrink-0 sticky top-20 self-start">
                     <FloatingVideoPlayer
                        path={videoInfo.path}
                        startTimestamp={videoInfo.startTimestamp}
                        appStartTime={startTime || 0}
                        currentTime={currentTime}
                        onMetadataLoaded={(meta) => setVideoMetadata(meta)}
                    />
                </div>
            );
        }
        return null; // or empty placeholder if you want to reserve space
    };


    return (
        <div
            className={`h-screen w-full bg-background text-foreground pb-20 overflow-y-auto transition-all duration-300 ${selectedEvent ? 'pr-[400px]' : ''}`}
            style={{ scrollbarGutter: 'stable' }}
        >
            <style>{`
        ::-webkit-scrollbar {
            width: 14px;
        }
        ::-webkit-scrollbar-track {
            background: transparent; 
        }
        ::-webkit-scrollbar-thumb {
            background-color: #334155;
            border-radius: 7px;
            border: 4px solid transparent;
            background-clip: content-box;
        }
        ::-webkit-scrollbar-corner {
            background: transparent;
        }
      `}</style>
            <header className="fixed top-0 left-0 right-0 h-14 border-b bg-background/95 backdrop-blur z-40 flex items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                        <h1 className="font-bold hidden md:block">Haibun Monitor</h1>
                        {startTime && (
                            <span className="text-[10px] text-muted-foreground hidden md:block">
                                {new Date(startTime).toISOString()}
                            </span>
                        )}
                    </div>
                    <Badge variant={connected ? "default" : "destructive"}>
                        {connected ? 'Live' : 'Offline'}
                    </Badge>
                    <div className="ml-4 flex rounded-md bg-secondary p-1">
                        {(['log', 'raw', 'document'] as ViewMode[]).map(mode => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`px-3 py-1 text-xs rounded-sm capitalize ${viewMode === mode ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="hidden md:flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Log Level:</span>
                        <select
                            className="bg-background text-foreground text-xs border rounded px-1"
                            value={minLogLevel}
                            onChange={e => setMinLogLevel(e.target.value)}
                        >
                            <option value="trace">Trace</option>
                            <option value="debug">Debug</option>
                            <option value="info">Info</option>
                            <option value="warn">Warn</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                    <div className="hidden md:flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Max Depth:</span>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={maxDepth}
                            onChange={e => setMaxDepth(parseInt(e.target.value))}
                            className="w-12 bg-transparent text-xs border rounded px-1"
                        />
                    </div>
                </div>
            </header>

            <main className="w-full pt-20 px-4 max-w-[1800px] mx-auto">
                <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                        {viewMode === 'log' && renderLogView()}

                        {viewMode === 'raw' && (
                            <pre className="text-xs font-mono bg-black p-4 rounded-lg shadow-xl overflow-x-auto text-green-400">
                                {JSON.stringify(visibleEvents, null, 2)}
                            </pre>
                        )}

                        {viewMode === 'document' && (
                            <div className="bg-black rounded-lg shadow-xl overflow-hidden min-h-[500px]">
                                 <DocumentView events={visibleEvents} />
                            </div>
                        )}
                    </div>
                    
                    {/* The shared slot for timely component  */}
                    {renderFloatingUI()}
                </div>
            </main>
            
            <Timeline 
                min={0}
                max={maxTime}
                current={currentTime}
                onChange={handleTimeChange}
                isPlaying={isPlaying}
                onPlayPause={togglePlay}
                events={events}
                startTime={startTime || 0}
                playbackSpeed={playbackSpeed}
                onSpeedChange={setPlaybackSpeed}
            />
            {selectedEvent && (
                <DetailsPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
            )}
        </div>
    );
}

const Badge = ({ children, variant }: any) => {
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${variant === 'default' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
            }`}>
            {children}
        </span>
    );
};

export default App
