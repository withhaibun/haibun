import React, { useState, useEffect, useRef, useMemo } from 'react'
import { DetailsPanel } from './DetailsPanel';

import { EventFormatter } from '@haibun/core/monitor/index.js'
import { Timeline } from './Timeline'
import { getInitialState } from './serialize';
import { THaibunEvent, TArtifactEvent, TVideoArtifact, TResolvedFeaturesArtifact, THttpTraceArtifact, HAIBUN_LOG_LEVELS, THaibunLogLevel } from '@haibun/core/schema/protocol.js';
import { DocumentView } from './DocumentView';
import { ArtifactRow } from './components/ArtifactRow';
import { StepMessage } from './components/StepMessage';
import { SourceLinks } from './components/SourceLinks';
import { EventIdDisplay } from './components/EventIdDisplay';
import { InlineArtifacts } from './components/InlineArtifacts';
import { TEST_IDS } from '../test-ids';
import { FUTURE_EVENT_CLASS, isEventInFuture, formatRelativeTime } from './lib/timeline';
import { scrollIntoViewIfNeeded } from './lib/dom-utils';

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
    // Error state for timeline data inconsistencies
    const [timelineError, setTimelineError] = useState<string | null>(null);

    // View Control State
    const [viewMode, setViewMode] = useState<ViewMode>('log');
    const [minLogLevel, setMinLogLevel] = useState<THaibunLogLevel>('info');
    const [maxDepth, setMaxDepth] = useState<number>(6);
    const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<THaibunEvent | null>(null);
    const [cwd, setCwd] = useState<string | null>(null);
    const [detailsPanelWidth, setDetailsPanelWidth] = useState<number>(() => {
        const saved = localStorage.getItem('detailsPanelWidth');
        return saved ? parseInt(saved, 10) : 400;
    });

    // New persistent view states
    const [viewOrder, setViewOrder] = useState<('sequence' | 'quad')[]>([]);
    const showQuadGraph = viewOrder.includes('quad');
    const showSequence = viewOrder.includes('sequence');

    // Video metadata extracted from loadedmetadata event
    const [videoMetadata, _setVideoMetadata] = useState<{
        duration: number;
        width: number;
        height: number;
    } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Debugger state
    // biome-ignore lint/suspicious/noExplicitAny: debug state
    const [activePrompt, setActivePrompt] = useState<any | null>(null);

    // Memoize WS options to prevent re-connection on render
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous message type
    const sendMessage = useRef<((msg: any) => void) | null>(null);

    // Event batching using refs to avoid re-render issues
    const pendingEventsRef = useRef<THaibunEvent[]>([]);
    const flushTimerRef = useRef<number | null>(null);

    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        // Define sendMessage
        // biome-ignore lint/suspicious/noExplicitAny: heterogeneous message type
        sendMessage.current = async (message: any) => {
            try {
                await fetch('/sse/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(message)
                });
            } catch (e) {
                console.error('Failed to send message', e);
            }
        };

        if (isSerializedMode) return;

        const connect = () => {
            const es = new EventSource('/sse');
            eventSourceRef.current = es;

            es.onopen = () => {
                console.log('SSE Open');
                setConnected(true);
                // Send ready message via POST
                sendMessage.current?.({ type: 'ready' });
            };

            es.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'event' && msg.event) {
                        pendingEventsRef.current.push(msg.event);
                        if (flushTimerRef.current === null) {
                            flushTimerRef.current = window.setTimeout(() => {
                                if (pendingEventsRef.current.length > 0) {
                                    const newEvents = [...pendingEventsRef.current];
                                    pendingEventsRef.current = [];
                                    setEvents(prev => {
                                        if (prev.length === 0 && newEvents.length > 0 && !startTime) {
                                            setStartTime(Date.now());
                                        }
                                        return [...prev, ...newEvents];
                                    });
                                }
                                flushTimerRef.current = null;
                            }, 100);
                        }
                    } else if (msg.type === 'prompt') {
                        console.log('Prompt received', msg);
                        setActivePrompt(msg.prompt);
                        setIsPlaying(false);
                    } else if (msg.type === 'init' && msg.cwd) {
                        setCwd(msg.cwd);
                        // Note: Cwd state setter not visible in context, check if declared
                    } else if (msg.type === 'finalize') {
                        console.log('Finalize received');
                        setIsPlaying(false);
                    }
                } catch (err) {
                    console.error('SSE Parse Error', err);
                }
            };

            es.onerror = (e) => {
                console.log('SSE Error', e);
                setConnected(false);
                es.close();
                setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            eventSourceRef.current?.close();
        };

    }, [isSerializedMode]);

    useEffect(() => {
        // biome-ignore lint/suspicious/noExplicitAny: error can be any type
        const logError = (type: string, error: any) => {
            fetch('/sse/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'log', message: `CLIENT_ERROR: ${type} - ${error?.message || error}` })
            }).catch(e => console.error(e));
        };

        window.onerror = (msg, source, lineno, colno, error) => {
            logError('onerror', `${msg} at ${source}:${lineno}:${colno}`);
        };
        window.onunhandledrejection = (event) => {
            logError('unhandledrejection', event.reason);
        };

        console.log('App mounted [Verified]');
        fetch('/sse/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'log', message: 'CLIENT_MOUNTED' })
        }).catch(err => console.error('Failed to log mount:', err));

        return () => {
            fetch('/sse/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'log', message: 'CLIENT_UNMOUNTED' })
            }).catch(e => console.error(e));
        };
    }, []);

    // Handle Time Logic - Calculate actual min/max timestamps from events
    // Events may not be sorted by timestamp, so we find actual bounds
    const eventsLength = events.length;

    const { minTimestamp, maxTimestamp } = useMemo(() => {
        if (events.length === 0) {
            return { minTimestamp: null, maxTimestamp: null };
        }
        let min = Infinity;
        let max = -Infinity;
        for (const e of events) {
            // Exclude events that shouldn't affect timeline bounds:
            // - 'control' events are heartbeats/keepalives
            // - Events from 'sse-transport' are internal transport messages
            // Both have current timestamps that inflate the timeline in STAY_ALWAYS mode
            if (e.kind === 'control') continue;
            if (e.emitter?.includes('sse-transport')) continue;

            if (e.timestamp !== undefined && e.timestamp !== null) {
                if (e.timestamp < min) min = e.timestamp;
                if (e.timestamp > max) max = e.timestamp;
            }
        }
        if (min === Infinity || max === -Infinity) {
            return { minTimestamp: null, maxTimestamp: null };
        }
        return { minTimestamp: min, maxTimestamp: max };
    }, [events]);

    useEffect(() => {
        if (eventsLength > 0 && minTimestamp !== null && maxTimestamp !== null) {
            // Validate serialized startTime if present
            // If initialState had startTime that doesn't match actual minTimestamp, this is a data error
            if (isSerializedMode && initialState?.startTime !== undefined && initialState.startTime !== null) {
                if (initialState.startTime !== minTimestamp) {
                    const errorMsg = `[Timeline] CRITICAL: Serialized startTime (${initialState.startTime}) does not match actual minTimestamp (${minTimestamp}). Data corruption or serialization error.`;
                    console.error(errorMsg, {
                        serializedStartTime: initialState.startTime,
                        actualMinTimestamp: minTimestamp,
                        maxTimestamp,
                        eventCount: eventsLength
                    });
                    setTimelineError(errorMsg);
                    return; // Don't proceed with invalid data
                }
            }

            // Set startTime to minTimestamp
            if (startTime === null || startTime !== minTimestamp) {
                setStartTime(minTimestamp);
            }

            // Duration is always maxTimestamp - minTimestamp
            const duration = maxTimestamp - minTimestamp;

            // Validate: duration should never be negative
            if (duration < 0) {
                const errorMsg = `[Timeline] CRITICAL: Duration is negative (${duration}). max=${maxTimestamp}, min=${minTimestamp}`;
                console.error(errorMsg);
                setTimelineError(errorMsg);
                return;
            }

            // Clear any previous errors
            setTimelineError(null);
            setMaxTime(duration);

            // In live mode, auto-advance to show latest
            if (connected) {
                setCurrentTime(duration);
            } else if (currentTime === 0 && duration > 0) {
                // Initialize to end for serialized reports
                setCurrentTime(duration);
            }
        }
    }, [eventsLength, minTimestamp, maxTimestamp, startTime, connected, isSerializedMode, initialState?.startTime]);


    // Compute video info from both video-start and video events
    // This allows us to show the video at the correct timeline position
    const videoInfo = useMemo(() => {
        const videoStartEvent = events.find(e =>
            e.kind === 'artifact' && e.artifactType === 'video-start'
        );
        const videoArtifactEvent = events.find(e =>
            e.kind === 'artifact' && e.artifactType === 'video'
        ) as TVideoArtifact | undefined;

        if (!videoStartEvent) return null;

        return {
            startTimestamp: videoStartEvent.timestamp,
            path: videoArtifactEvent?.path ?? null,
        };
    }, [events]);

    const videoStartTimestamp = videoInfo?.startTimestamp ?? null;

    const handleDebugAction = (response: string) => {
        if (connected && activePrompt) {
            sendMessage.current?.({
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

    // Format ID helper (replicates server-side formatCurrentSeqPath)
    const formatSeqPath = (seqPath: number[]) => '[' + seqPath.join('.') + ']';

    // Index ResolvedFeatures
    type TStepIndex = Record<string, { in: string; seqPath: number[]; source?: { path?: string; lineNumber?: number }; action?: { actionName?: string; stepperName?: string } }>;
    const _stepIndex = useMemo((): TStepIndex => {
        const artifact = events.find((e): e is TResolvedFeaturesArtifact => e.kind === 'artifact' && e.artifactType === 'resolvedFeatures');
        if (!artifact) return {};
        const index: TStepIndex = {};

        // Index Features and Steps
        artifact.resolvedFeatures?.forEach((rf) => {
            // Index Feature
            // rf.path is absolute, but maybe we shouldn't index feature start/end by path?
            // Events have ID like feat-N. 
            // We can't easily map feat-N to path without the map provided in Executor runtime tags.
            // But here we care about STEPS.
            const resolvedFeature = rf as { featureSteps?: Array<{ seqPath?: number[]; in?: string; source?: { path?: string; lineNumber?: number }; action?: { actionName?: string; stepperName?: string } }> };
            resolvedFeature.featureSteps?.forEach((step) => {
                if (step.seqPath) {
                    const id = formatSeqPath(step.seqPath);
                    index[id] = {
                        in: step.in || '',
                        seqPath: step.seqPath,
                        source: step.source,
                        action: step.action,
                    };
                }
            });
        });
        return index;
    }, [events]);

    // Unified Event Processing Pipeline
    const visibleEvents = useMemo(() => {
        const effectiveStart = startTime || 0;

        // Stage 1: No Time Filter (we want to see future events)
        const timeFiltered = events;

        const isFuture = (e: THaibunEvent) => {
            if (e.timestamp === undefined) return false;
            return (e.timestamp - effectiveStart) > currentTime;
        }

        // Stage 2: Lifecycle Merging (Deduplication/Update-in-place)
        // We merge start/end events so only one row shows per step,
        // but we keep the start events if we have no end yet to show progress.
        // NEW: We do NOT merge a future event into a past event, to preserve the "current state" vs "future state" view.
        const mergedEvents = timeFiltered.reduce((acc, e) => {
            if (e.kind === 'lifecycle' && e.id) {
                const existingIndex = acc.findIndex((existing: THaibunEvent) => existing.id === e.id);
                if (existingIndex !== -1) {
                    const existing = acc[existingIndex];

                    // Check if we are crossing the timeline boundary
                    const existingFuture = isFuture(existing);
                    const newFuture = isFuture(e);

                    // If one is past and one is future, keep both (don't merge)
                    if (existingFuture !== newFuture) {
                        return [...acc, e];
                    }

                    // If we have an 'end' stage, it should overwrite 'start'
                    if (existing.stage === 'start' && e.stage === 'end') {
                        const newAcc = [...acc];
                        newAcc[existingIndex] = e;
                        return newAcc;
                    }
                    // If it's the same stage, just keep the latest
                    if (existing.stage === e.stage) {
                        const newAcc = [...acc];
                        newAcc[existingIndex] = e;
                        return newAcc;
                    }
                }
                return [...acc, e];
            }
            return [...acc, e];
            // biome-ignore lint/suspicious/noExplicitAny: complex reduce
        }, [] as any[]);

        // Stage 3: Visibility Filter & Hidden Log Aggregation
        const levels = [...HAIBUN_LOG_LEVELS];
        const minLevelIndex = levels.indexOf(minLogLevel);

        // biome-ignore lint/suspicious/noExplicitAny: complex merge
        const finalEvents: any[] = [];
        let hiddenBuffer: { event: THaibunEvent; reason: 'level' | 'depth' }[] = [];

        const flushHiddenBuffer = () => {
            if (hiddenBuffer.length > 0) {
                const bufferLevels = new Set(hiddenBuffer.map(h => h.event.level || 'info'));
                // biome-ignore lint/suspicious/noExplicitAny: sort comparison
                const sortedBufferLevels = Array.from(bufferLevels).sort((a: any, b: any) => levels.indexOf(b) - levels.indexOf(a));
                const primaryHiddenLevel = sortedBufferLevels[0] || 'info';

                const types = new Set(hiddenBuffer.map(h => {
                    const e = h.event;
                    if (e.kind === 'artifact') return e.artifactType;
                    if (e.kind === 'lifecycle') return e.type;
                    return e.kind;
                }));

                const depthCount = hiddenBuffer.filter(h => h.reason === 'depth').length;
                const levelCount = hiddenBuffer.filter(h => h.reason === 'level').length;

                finalEvents.push({
                    kind: 'hidden-block',
                    count: hiddenBuffer.length,
                    level: primaryHiddenLevel,
                    types: Array.from(types),
                    id: `hidden-${finalEvents.length}-${hiddenBuffer[0].event.id}`,
                    firstEventId: hiddenBuffer[0].event.id,
                    depthCount,
                    levelCount,
                });
                hiddenBuffer = [];
            }
        };

        mergedEvents.forEach((e: THaibunEvent) => {
            let isVisible = true;
            let hideReason: 'level' | 'depth' = 'level';

            // Log Level Check
            const rawLevel = e.level || 'info';
            const levelIndex = levels.indexOf(rawLevel);

            if (levelIndex !== -1 && minLevelIndex !== -1 && levelIndex < minLevelIndex) {
                isVisible = false;
                hideReason = 'level';
            }

            // Depth Check
            if (isVisible && e.id) {
                const depth = e.id.split('.').length;
                if (depth > maxDepth) {
                    isVisible = false;
                    hideReason = 'depth';
                }
            }

            if (isVisible) {
                flushHiddenBuffer();
                finalEvents.push(e);
            } else {
                hiddenBuffer.push({ event: e, reason: hideReason });
            }
        });

        flushHiddenBuffer();
        return finalEvents;
    }, [events, currentTime, startTime, minLogLevel, maxDepth]);

    // Auto-scroll logic - only scroll if element is not already visible
    useEffect(() => {
        if (scrollTargetId) {
            const el = document.getElementById(`event-${scrollTargetId}`);
            if (el) {
                // Only scroll if the element is not currently visible
                scrollIntoViewIfNeeded(el, null, { behavior: 'auto', block: 'start' });
                setScrollTargetId(null);
            }
        } else if (isPlaying && visibleEvents.length > 0 && startTime !== null) {
            // Auto-scroll logic for playback
            // Find event closest to current time (from bottom up)
            const relativeTime = currentTime;
            const currentEvent = [...visibleEvents].reverse().find(e =>
                e.timestamp !== undefined && (e.timestamp - startTime) <= relativeTime
            );

            if (currentEvent) {
                const el = document.getElementById(`event-${currentEvent.id}`);
                if (el) {
                    scrollIntoViewIfNeeded(el, null, { behavior: 'auto', block: 'nearest' });
                }
            }
        } else if (scrollRef.current && visibleEvents.length > 0 && connected && !scrollTargetId) {
            // Only auto-scroll to bottom in live mode if not already visible
            scrollIntoViewIfNeeded(scrollRef.current, null, { behavior: 'auto', block: 'center' });
        }
    }, [visibleEvents.length, scrollTargetId, connected, isPlaying, currentTime, startTime]);

    const renderLogView = () => (
        <div className="font-mono text-xs w-full bg-black p-4 rounded-lg shadow-xl overflow-hidden pb-12">
            {visibleEvents.map((e, i, arr) => {
                // Hidden blocks are synthetic events injected by visibility filtering
                if (e.kind === 'hidden-block') {
                    const block = e as { id: string; count: number; types: string[]; level: string; firstEventId: string; depthCount: number; levelCount: number };
                    const typesStr = block.types.join(', ');
                    const reasonParts = [];
                    if (block.levelCount > 0) reasonParts.push(`${block.levelCount} by ${block.level.toUpperCase()}`);
                    if (block.depthCount > 0) reasonParts.push(`${block.depthCount} by depth`);
                    const reasonStr = reasonParts.join(', ');
                    return (
                        <div key={block.id} className="flex justify-start my-1 px-2">
                            <button
                                onClick={() => {
                                    if (block.depthCount > 0 && block.depthCount >= block.levelCount) {
                                        setMaxDepth(prev => prev + 2);
                                    } else {
                                        setMinLogLevel(block.level as THaibunLogLevel);
                                    }
                                    // Scroll the event into view after the details panel renders
                                    const prevEvent = i > 0 ? arr[i - 1] : undefined;
                                    setScrollTargetId(prevEvent ? prevEvent.id : block.firstEventId);
                                }}
                                className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer transition-colors flex items-center gap-1 italic font-light tracking-wide"
                            >
                                <span>~~~ {block.count} {typesStr} hidden ({reasonStr}) ~~~</span>
                            </button>
                        </div>
                    );
                }

                const isLast = i === arr.length - 1;
                const prevE = i > 0 ? arr[i - 1] : undefined;
                // Ensure prevE is a standard event for formatting check (skip hidden blocks)
                // biome-ignore lint/suspicious/noExplicitAny: loose event type
                const validPrevE = prevE && (prevE as any).kind !== 'hidden-block' ? prevE : undefined;
                const prevLevel = validPrevE ? EventFormatter.getDisplayLevel(validPrevE) : undefined;

                const formatted = EventFormatter.formatLineElements(e, prevLevel);

                // Calculate display time and future status
                // If startTime is null, we don't have timeline data yet - don't dim anything
                let time = '0.000';
                let isFuture = false;

                if (startTime !== null) {
                    try {
                        const relativeTime = e.timestamp - startTime;
                        time = formatRelativeTime(relativeTime);
                        isFuture = isEventInFuture(e.timestamp, startTime, currentTime);
                    } catch (err) {
                        // Log but don't crash on invalid timestamp
                        console.error('[App] Timeline calculation error:', err);
                    }
                }
                const futureClass = isFuture ? FUTURE_EVENT_CLASS : '';

                let { showLevel: _showLevel, message, icon, id } = formatted;
                // const isLifecycle = e.kind === 'lifecycle'; // unwarn
                const depth = e.id ? e.id.split('.').length : 0;
                const isNested = depth > 3;

                let textClass = 'text-gray-300';
                const bgClass = isLast ? 'bg-primary/20 border-l-2 border-primary' : 'hover:bg-gray-900 border-l-2 border-transparent';

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
                        message = e.error || ('topics' in e ? JSON.stringify(e.topics) : '');
                    }
                } else if (e.kind === 'log') {
                    if (e.level === 'error') textClass = 'text-red-500 font-bold';
                    if (e.level === 'warn') textClass = 'text-yellow-400';
                    if (!message) {
                        // biome-ignore lint/suspicious/noExplicitAny: loose attributes
                        message = e.message || (e.attributes as Record<string, any>)?.message || JSON.stringify(e.attributes);
                    }
                } else if (e.kind === 'control') {
                    if (!message) {
                        const data = e.args || ('topics' in e ? e.topics : null);
                        message = data ? `[${e.signal}] ${JSON.stringify(data)}` : `[${e.signal}]`;
                    }
                }

                // Check if this event initiates a nested block
                // Identify next *visible* event that is not a hidden block
                let nextEvent = undefined;
                for (let j = i + 1; j < arr.length; j++) {
                    // biome-ignore lint/suspicious/noExplicitAny: loose event type
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
                            data-testid={isLast ? TEST_IDS.VIEWS.LATEST_EVENT : `${TEST_IDS.TIMELINE_SELECTION.LOG_ROW_PREFIX}${e.id}`}
                            className={`flex whitespace-pre items-start leading-tight transition-colors ${bgClass} cursor-pointer hover:bg-slate-800 ${selectedEvent === e ? 'bg-cyan-900/30 border-l-4 border-l-cyan-500 -ml-1 pl-1 border-r-4 border-r-cyan-500' : ''} ${futureClass}`}
                            onClick={() => {
                                setSelectedEvent(e);
                                setIsPlaying(false);
                                if (e.timestamp && startTime !== null) {
                                    setCurrentTime(Math.max(0, e.timestamp - startTime));
                                }
                                // No auto-scroll on manual select
                            }}
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
                                    {e.kind === 'artifact' ? (
                                        <ArtifactRow
                                            e={e as TArtifactEvent}
                                            onSelect={() => {
                                                setSelectedEvent(e);
                                                setIsPlaying(false);
                                                if (e.timestamp && startTime !== null) {
                                                    setCurrentTime(Math.max(0, e.timestamp - startTime));
                                                }
                                                setTimeout(() => {
                                                    const el = document.getElementById(`event-${e.id}`);
                                                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }, 50);
                                            }}
                                            isSerializedMode={isSerializedMode}
                                            isSelected={selectedEvent === e}
                                        />
                                    ) : (
                                        <>
                                            <span className={`inline-block w-4 text-center shrink-0 ${icon === '⟳' ? 'animate-spin' : ''}`}>{icon}</span>
                                            <StepMessage
                                                message={message}
                                                canLink={!isSerializedMode && e.kind === 'lifecycle' && e.type === 'step' && !!(e.kind === 'lifecycle' && 'featurePath' in e && e.featurePath && 'lineNumber' in e && e.lineNumber && cwd)}
                                                absolutePath={e.kind === 'lifecycle' && 'featurePath' in e && e.featurePath && cwd
                                                    ? (e.featurePath.startsWith('/') ? `${cwd}${e.featurePath}` : `${cwd}/${e.featurePath}`)
                                                    : undefined}
                                                lineNumber={e.kind === 'lifecycle' && 'lineNumber' in e ? e.lineNumber : undefined}
                                            />
                                            {/* Column 3: SourceLinks (Race Info) - Hide when details panel is open */}
                                            {!selectedEvent && (
                                                <SourceLinks
                                                    featurePath={e.kind === 'lifecycle' && 'featurePath' in e ? e.featurePath : undefined}
                                                    lineNumber={e.kind === 'lifecycle' && 'lineNumber' in e ? e.lineNumber : undefined}
                                                    emitter={e.emitter}
                                                    cwd={cwd}
                                                    isSerializedMode={isSerializedMode}
                                                    isBackground={!!(e.kind === 'lifecycle' && 'featurePath' in e && e.featurePath?.includes('/backgrounds/'))}
                                                    isWaypoint={e.kind === 'lifecycle' && (e.type === 'ensure' || e.type === 'activity')}
                                                />
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: SeqPath - Always show (revert hide) */}
                            <div className="w-24 text-[10px] text-slate-500 font-mono text-right ml-2 py-1 select-all hover:text-slate-300 break-words">
                                <div title={e.id}>
                                    <EventIdDisplay e={e} />
                                </div>
                            </div>
                        </div>

                        {/* Inline Artifacts */}
                        <InlineArtifacts
                            e={e}
                            onSelectArtifact={(artifact) => {
                                setSelectedEvent(artifact);
                                setIsPlaying(false);
                                if (artifact.timestamp && startTime !== null) {
                                    setCurrentTime(Math.max(0, artifact.timestamp - startTime));
                                }
                                setTimeout(() => {
                                    const el = document.getElementById(`event-${artifact.id}`);
                                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 50);
                            }}
                            selectedArtifactId={selectedEvent?.id}
                        />
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

    // Shared "Floating UI" container for Video (Debugger moved to DetailsPanel)
    const renderFloatingUI = () => {
        // Video is now shown in details panel when its event is selected
        return null;
    };


    // Collect data for synthetic props passed to DetailsPanel if views are active
    // We compute this on the fly: if showSequence is true, we need 'allTraces' etc.
    // If showQuadGraph is true, we need 'quads'.

    const enrichedSelectedEvent = useMemo(() => {
        // Base event is selectedEvent OR a dummy holder
        // biome-ignore lint/suspicious/noExplicitAny: synthetic construction
        let base: any = selectedEvent;

        // Force panel open if Debugger is active or Views are active
        if (!base && (showQuadGraph || showSequence || (connected && activePrompt))) {
            // Find a valid timestamp anchor (e.g. current time or last event)
            const anchorEvent = events.find(e => e.kind === 'lifecycle') || events[0];
            base = {
                id: 'synthetic-view-anchor',
                kind: 'control',
                signal: 'view-anchor',
                timestamp: startTime || anchorEvent?.timestamp || Date.now(),
                _isSynthetic: true
            };
        }

        if (!base) return null;

        // Spread base to avoid mutating state
        const enriched = { ...base };

        // Attach Sequence Data if needed
        if (showSequence) {
            const httpTraces = events.filter(e => e.kind === 'artifact' && e.artifactType === 'http-trace') as THttpTraceArtifact[];
            if (httpTraces.length > 0) {
                enriched._allTraces = httpTraces;
            }
        }

        // Attach Quad Data if needed
        if (showQuadGraph) {
            // biome-ignore lint/suspicious/noExplicitAny: quad check
            const quadObservations = events.filter(e => e.kind === 'artifact' && e.artifactType === 'json' && (e as any).json?.quadObservation);
            if (quadObservations.length > 0) {
                // biome-ignore lint/suspicious/noExplicitAny: quad map
                const quads = quadObservations.map((e: any) => ({
                    ...e.json.quadObservation,
                    timestamp: e.json.quadObservation.timestamp ?? e.timestamp,
                }));
                enriched._quads = quads;
            }
        }

        return enriched as THaibunEvent;

    }, [selectedEvent, showQuadGraph, showSequence, connected, activePrompt, events, startTime]);

    // Render error if timeline data is corrupt
    if (timelineError) {
        return (
            <div className="h-screen w-full bg-red-900 text-white p-8 flex flex-col items-center justify-center">
                <h1 className="text-3xl font-bold mb-4">⚠️ Timeline Data Error</h1>
                <div className="bg-red-950 p-6 rounded-lg max-w-3xl">
                    <p className="font-mono text-sm whitespace-pre-wrap break-all">{timelineError}</p>
                </div>
                <p className="mt-6 text-lg">The serialized data is corrupt. Check console for details.</p>
            </div>
        );
    }

    return (
        <div
            className={`h-screen w-full bg-background text-foreground pb-20 overflow-y-auto transition-all duration-300`}
            style={{ scrollbarGutter: 'stable', paddingRight: (enrichedSelectedEvent) ? `${detailsPanelWidth}px` : undefined }}
            data-testid="app-root"
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
            <header className="fixed top-0 left-0 right-0 h-14 border-b bg-background/95 backdrop-blur z-40 flex items-center justify-between px-4" data-testid={TEST_IDS.APP.HEADER}>
                <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                        <h1 className="font-bold hidden md:block" data-testid={TEST_IDS.HEADER.TITLE}>Haibun Monitor</h1>
                        {startTime && (
                            <span className="text-[10px] text-muted-foreground hidden md:block">
                                {new Date(startTime).toISOString()}
                            </span>
                        )}
                    </div>
                    <Badge variant={connected ? "default" : "destructive"} data-testid={TEST_IDS.HEADER.STATUS_BADGE}>
                        {connected ? 'Live' : 'Offline'}
                    </Badge>
                    <div className="ml-4 flex rounded-md bg-secondary p-1" data-testid={TEST_IDS.HEADER.VIEW_MODES}>
                        {(['log', 'raw', 'document'] as ViewMode[]).map(mode => (
                            <button
                                key={mode}
                                onClick={() => { setViewMode(mode); setSelectedEvent(null); }}
                                className={`px-3 py-1 text-xs rounded-sm capitalize ${viewMode === mode ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                data-testid={`button-view-${mode}`}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>

                    {/* Timeline Artifact Icons */}
                    <div className="ml-2 flex items-center gap-1" data-testid={TEST_IDS.HEADER.ARTIFACT_ICONS}>
                        {videoInfo?.path && (
                            <button
                                onClick={() => {
                                    const videoArtifact = events.find(e => e.kind === 'artifact' && e.artifactType === 'video') as TVideoArtifact | undefined;
                                    if (videoArtifact) setSelectedEvent(videoArtifact);
                                }}
                                // biome-ignore lint/suspicious/noExplicitAny: loose event type
                                className={`p-1.5 hover:bg-slate-700 rounded transition-colors ${selectedEvent?.kind === 'artifact' && (selectedEvent as any).artifactType === 'video' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 grayscale'}`}
                                title="View Video"
                            >
                                ▶
                            </button>
                        )}
                        {events.some(e => e.kind === 'artifact' && e.artifactType === 'http-trace') && (
                            <button
                                onClick={() => setViewOrder(prev => prev.includes('sequence') ? prev.filter(v => v !== 'sequence') : [...prev, 'sequence'])}
                                className={`p-1.5 hover:bg-slate-700 rounded transition-colors ${showSequence ? 'bg-slate-800' : 'grayscale opacity-60 hover:opacity-80'}`}
                                title={`Toggle HTTP Sequence Diagram (${events.filter(e => e.kind === 'artifact' && e.artifactType === 'http-trace').length})`}
                                data-testid={TEST_IDS.HEADER.TOGGLE_SEQUENCE}
                            >
                                ⇄
                            </button>
                        )}
                        {events.some(e => e.kind === 'artifact' && e.artifactType === 'json' && 'json' in e && (e.json as Record<string, unknown>)?.quadObservation) && (
                            <button
                                onClick={() => setViewOrder(prev => prev.includes('quad') ? prev.filter(v => v !== 'quad') : [...prev, 'quad'])}
                                className={`p-1.5 hover:bg-slate-700 rounded transition-colors ${showQuadGraph ? 'bg-slate-800' : 'grayscale opacity-60 hover:opacity-80'}`}
                                title={`Toggle QuadStore Graph (${events.filter(e => e.kind === 'artifact' && e.artifactType === 'json' && 'json' in e && (e.json as Record<string, unknown>)?.quadObservation).length} observations)`}
                                data-testid={TEST_IDS.HEADER.TOGGLE_QUAD}
                            >
                                📐
                            </button>
                        )}
                        {activePrompt && (
                            <button
                                onClick={() => {
                                    // Force panel open by selecting a synthetic event
                                    if (!selectedEvent) {
                                        const anchorEvent = events.find(e => e.kind === 'lifecycle') || events[0];
                                        if (anchorEvent) setSelectedEvent(anchorEvent);
                                    }
                                }}
                                className="p-1.5 hover:bg-slate-700 rounded transition-colors bg-slate-800"
                                title="Debug prompt active"
                                data-testid={TEST_IDS.HEADER.TOGGLE_DEBUG}
                            >
                                🐞
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="hidden md:flex items-center gap-2" data-testid={TEST_IDS.HEADER.LOG_LEVEL}>
                        <span className="text-xs text-muted-foreground">Log Level:</span>
                        <select
                            className="bg-background text-foreground text-xs border rounded px-1"
                            value={minLogLevel}
                            onChange={e => setMinLogLevel(e.target.value as THaibunLogLevel)}
                        >
                            {HAIBUN_LOG_LEVELS.map(level => (
                                <option key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                    <div className="hidden md:flex items-center gap-2" data-testid={TEST_IDS.HEADER.MAX_DEPTH}>
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
            </header >

            <main className="w-full pt-20 px-4 max-w-[1800px] mx-auto" data-testid={TEST_IDS.APP.MAIN}>
                <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                        {viewMode === 'log' && <div data-testid={TEST_IDS.VIEWS.LOG}>{renderLogView()}</div>}
                        {viewMode === 'raw' && <pre data-testid={TEST_IDS.VIEWS.RAW} className="text-xs p-4 overflow-auto">{JSON.stringify(events, null, 2)}</pre>}
                        {viewMode === 'document' && (
                            <DocumentView
                                events={events}
                                currentTime={currentTime}
                                onTimeChange={handleTimeChange}
                                startTime={startTime}
                                minLogLevel={minLogLevel}
                                onSelectEvent={(e) => {
                                    setIsPlaying(false);
                                    if (e.timestamp && startTime !== null) {
                                        setCurrentTime(Math.max(0, e.timestamp - startTime));
                                    }
                                }}
                            />
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
            {
                enrichedSelectedEvent && (
                    <DetailsPanel
                        event={enrichedSelectedEvent}
                        onClose={() => {
                            setSelectedEvent(null);
                            setViewOrder([]);
                        }}
                        width={detailsPanelWidth}
                        onWidthChange={(w) => {
                            setDetailsPanelWidth(w);
                            localStorage.setItem('detailsPanelWidth', String(w));
                        }}
                        currentTime={currentTime}
                        videoStartTimestamp={videoStartTimestamp}
                        videoMetadata={videoMetadata}
                        isPlaying={isPlaying}
                        startTime={startTime || 0}
                        cwd={cwd}
                        isSerializedMode={isSerializedMode}
                        viewOrder={viewOrder}
                        activePrompt={activePrompt}
                        onDebugSubmit={handleDebugAction}
                    />
                )
            }
        </div >
    );
}

// biome-ignore lint/suspicious/noExplicitAny: simple component props
const Badge = ({ children, variant, ...props }: any) => {
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${variant === 'default' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
            }`} {...props}>
            {children}
        </span>
    );
};

export default App
