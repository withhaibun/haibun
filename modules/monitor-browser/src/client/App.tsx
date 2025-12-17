import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Timeline } from './Timeline'
import { EventFormatter } from '@haibun/core/monitor'
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { Debugger } from './Debugger';
import { getInitialState } from './serialize';
import { Button } from './components/ui/button';
import { THaibunEvent, TArtifactEvent } from './types';
import { DocumentView } from './DocumentView';
import { ArtifactRenderer } from './artifacts';

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
                    setActivePrompt(msg);
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
            console.log('[App] Serialized mode - connected set to false');
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

    // Filter events based on time and controls
    const visibleEvents = useMemo(() => {
        const effectiveStart = startTime || 0;
        const levels = ['trace', 'debug', 'info', 'warn', 'error'];
        const minLevelIndex = levels.indexOf(minLogLevel);

        return events.filter(e => {
            // Skip null/undefined events or events without timestamp
            if (!e || e.timestamp === undefined) return true;

            // Time filter - always apply (works in both live and replay mode)
            if ((e.timestamp - effectiveStart) > currentTime) return false;

            // Log Level Filter
            // Use refined level logic
            const rawLevel = e.kind === 'log' ? e.level : 'info'; // Treat lifecycle as info by default
            const normalizedLevel = (rawLevel as string) === 'log' ? 'info' : rawLevel; // Handle 'log' alias

            const levelIndex = levels.indexOf(normalizedLevel);
            // If level is unknown (e.g. custom), assume it's verbose/low-level? Or show it?
            // Let's assume unknown levels are shown if we can't rank them, or treat as info.
            // For now, if index found, filter. If not found, show.
            if (levelIndex !== -1 && levelIndex < minLevelIndex) return false;

            // Depth Filter (Approximate using id length or periods if seqPath not explicit)
            // Most IDs are like "1.2.3". Split by dot to get depth.
            if (e.id) {
                const depth = e.id.split('.').length;
                if (depth > maxDepth) return false;
            }

            return true;
        });
    }, [events, currentTime, startTime, minLogLevel, maxDepth]);

    // Auto-scroll when new events arrive
    useEffect(() => {
        if (scrollRef.current && visibleEvents.length > 0) {
            scrollRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    }, [visibleEvents.length]);

    // Re-use logic for log format
    const renderLogView = () => (
        <div className="font-mono text-xs w-full bg-black p-4 rounded-lg shadow-xl overflow-hidden">
            {visibleEvents
                .reduce((acc, e) => {
                    // Skip null/undefined events
                    if (!e) return acc;

                    // Filter out single-component IDs if needed
                    if (e.id && /^\[\d+\]$/.test(e.id)) {
                        return acc;
                    }
                    // Update-in-place logic for features/running steps
                    if (e.kind === 'lifecycle' && e.id) {
                        const existingIndex = acc.findIndex(existing => existing.id === e.id);
                        if (existingIndex !== -1) {
                            const newAcc = [...acc];
                            // Only update if the new event is 'more complete' or a state change?
                            // For now simple replacement as per original logic
                            newAcc[existingIndex] = e;
                            return newAcc;
                        }
                    }
                    return [...acc, e];
                }, [] as any[])
                .map((e, i, arr) => {
                    // Skip null/undefined events
                    if (!e) return null;

                    const isLast = i === arr.length - 1;
                    const prevE = i > 0 ? arr[i - 1] : undefined;
                    const prevLevel = prevE ? EventFormatter.getDisplayLevel(prevE) : undefined;

                    const formatted = EventFormatter.formatLineElements(e, prevLevel);

                    const effectiveStart = startTime || e.timestamp;
                    const time = ((e.timestamp - effectiveStart) / 1000).toFixed(3);

                    let { showLevel, message, icon, id } = formatted;
                    const isLifecycle = e.kind === 'lifecycle';
                    const depth = e.id ? e.id.split('.').length : 0;
                    const isNested = depth > 3;

                    let textClass = 'text-gray-300';
                    let bgClass = isLast ? 'bg-primary/20 border-l-2 border-primary' : 'hover:bg-gray-900 border-l-2 border-transparent';

                    // Indentation style for nested views
                    const indentStyle = isNested ? { paddingLeft: `${(depth - 3) * 1}rem` } : {};

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
                    } else if (e.kind === 'log') {
                        if (e.level === 'error') textClass = 'text-red-500 font-bold';
                        if (e.level === 'warn') textClass = 'text-yellow-400';
                    } else {
                        if (!message) {
                            message = e.message || (e.payload as any)?.message || JSON.stringify(e.payload);
                        }
                    }

                    // Check if this event initiates a nested block
                    const nextEvent = visibleEvents[i + 1];
                    const isInstigator = nextEvent && nextEvent.id.startsWith(id + '.');

                    const prevDepth = prevE ? (prevE.id ? prevE.id.split('.').length : 0) : 0;
                    // Only show symbol if this row "goes deeper" than the previous one (i.e. is the first child).
                    // Sibilings (prevDepth === depth) will not have the line.
                    const showSymbol = prevE && prevDepth < depth;

                    return (
                        <React.Fragment key={i}>
                            <div className={`flex whitespace-pre items-stretch leading-tight transition-colors ${bgClass}`}>
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
                                                    </button>
                                                    {isExpanded && (
                                                        <div className="p-2 mt-1 border border-slate-700 rounded bg-slate-900/50">
                                                            <ArtifactRenderer artifact={e as TArtifactEvent} />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : (
                                            <>
                                                <span className={`inline-block w-4 text-center shrink-0 ${icon === '⟳' ? 'animate-spin' : ''}`}>{icon}</span>
                                                <span className="whitespace-pre-wrap break-words">{message}</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Right Column: SeqPath */}
                                <div className="w-24 shrink-0 text-[10px] text-slate-500 font-mono text-right ml-2 py-1 select-all hover:text-slate-300">
                                    <div title={e.id}>{e.id}</div>
                                </div>
                            </div>

                            {/* Inline Artifacts - each artifact has its own toggle */}
                            {(() => {
                                const eventAny = e as any;
                                const embeddedArtifacts = eventAny.payload?.artifacts || eventAny.incidentDetails?.artifacts;
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
                                                                <ArtifactRenderer artifact={artifactEvent} />
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

    return (
        <div
            className="h-screen w-full bg-background text-foreground pb-20 overflow-y-auto"
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

            <main className="w-full pt-20 px-2">
                <Debugger
                    prompt={activePrompt}
                    onSubmit={handleDebugAction}
                />

                {viewMode === 'log' && renderLogView()}

                {viewMode === 'raw' && (
                    <pre className="text-xs font-mono bg-black p-4 rounded-lg shadow-xl overflow-x-auto text-green-400">
                        {JSON.stringify(visibleEvents, null, 2)}
                    </pre>
                )}

                {viewMode === 'document' && (
                    <DocumentView events={visibleEvents} />
                )}

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
        </div>
    )
};

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
