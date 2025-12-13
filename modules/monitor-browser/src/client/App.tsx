import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Timeline } from './Timeline'
import { EventFormatter } from '@haibun/core/monitor'
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { Debugger } from './Debugger';
import { getInitialState } from './serialize';
import { Button } from './components/ui/button';
import { THaibunEvent } from './types';
import { DocumentView } from './DocumentView';

type ViewMode = 'log' | 'raw' | 'document';

function App() {

  const initialState = getInitialState();
  const [events, setEvents] = useState<THaibunEvent[]>(() => initialState || []);
  const [connected, setConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [maxTime, setMaxTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // View Control State
  const [viewMode, setViewMode] = useState<ViewMode>('log');
  const [minLogLevel, setMinLogLevel] = useState<string>('info');
  const [maxDepth, setMaxDepth] = useState<number>(10);

  // Debugger state
  const [activePrompt, setActivePrompt] = useState<any | null>(null);

  const ws = useRef<WebSocket | null>(null);
  
  const { sendJsonMessage, readyState } = useWebSocket(`ws://localhost:8080`, {
      onOpen: () => {
          console.log('WS Connected');
          sendJsonMessage({ type: 'ready' });
      },
      onMessage: (msg) => {
           try {
              const data = JSON.parse(msg.data);
              if (data.type === 'event') {
                  const event = data.event;
                  setEvents(prev => {
                      const newEvents = [...prev, event];
                      return newEvents;
                  });
              } else if (data.type === 'prompt') {
                  setActivePrompt(data.prompt);
                  setIsPlaying(false);
              } else if (data.type === 'finalize') {
                  // Finalize handled by server now
                  console.log('Finalize received');
              }
          } catch (e) {
              console.error('WS Parse Error', e);
          }
      },
      shouldReconnect: () => true,
  });

  useEffect(() => {
    setConnected(readyState === ReadyState.OPEN);
  }, [readyState]);

  // Handle Time Logic - Anchor to first event
  useEffect(() => {
    if (events.length > 0) {
        if (startTime === null) {
            setStartTime(events[0].timestamp);
        }
        
        // Update max time
        const first = startTime || events[0].timestamp;
        const last = events[events.length - 1].timestamp;
        const newMax = last - first;
        setMaxTime(newMax);
        
        // Auto-advance time if live/connected and not specifically paused/scrubbing? 
        // Simple logic: if connected, always show latest.
        if (connected) {
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

  const togglePlay = () => setIsPlaying(!isPlaying);

  // Filter events based on time and controls
  const visibleEvents = useMemo(() => {
      const effectiveStart = startTime || 0;
      const levels = ['trace', 'debug', 'info', 'warn', 'error'];
      const minLevelIndex = levels.indexOf(minLogLevel);

      return events.filter(e => {
          // Time filter
          if (!connected && (e.timestamp - effectiveStart) > currentTime) return false;
          
          // Log Level Filter
          // Use refined level logic
          const rawLevel = e.kind === 'log' ? e.level : 'info'; // Treat lifecycle as info by default
          const normalizedLevel = rawLevel === 'log' ? 'info' : rawLevel; // Handle 'log' alias
          
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
  }, [events, currentTime, connected, startTime, minLogLevel, maxDepth]);

  // Re-use logic for log format
  const renderLogView = () => (
        <div className="font-mono text-xs max-w-6xl mx-auto bg-black p-4 rounded-lg shadow-xl overflow-x-auto">
            {visibleEvents
                .reduce((acc, e) => {
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
                    const isLast = i === arr.length - 1;
                    const prevE = i > 0 ? arr[i-1] : undefined;
                    const prevLevel = prevE ? EventFormatter.getDisplayLevel(prevE) : undefined;
                    
                    const formatted = EventFormatter.formatLineElements(e, prevLevel);
                    
                    const effectiveStart = startTime || e.timestamp;
                    const time = ((e.timestamp - effectiveStart)/1000).toFixed(3);
                    
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
                        <div key={i} className={`flex whitespace-pre items-stretch leading-tight transition-colors ${bgClass}`}>
                            <div className="w-12 flex flex-col items-end shrink-0 text-[10px] text-slate-700 dark:text-slate-400 font-medium leading-tight mr-2 self-stretch py-1">
                                <span>{time}s</span>
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

                                <div className="flex items-start gap-2 flex-1 py-1">
                                    <span className={`inline-block w-4 text-center shrink-0 ${icon === '⟳' ? 'animate-spin' : ''}`}>{icon}</span>
                                    <span>{message}</span>
                                </div>
                            </div>

                            {/* Right Column: SeqPath */}
                            <div className="w-24 shrink-0 text-[10px] text-slate-500 font-mono text-right ml-2 py-1 select-all hover:text-slate-300">
                                {showLevel}
                            </div>
                        </div>
                    );
                })}
                 {/* Auto-scroll */}
                <div ref={(el) => {
                    if (el && visibleEvents.length > 0) {
                        el.scrollIntoView({ behavior: 'auto', block: 'center' });
                    }
                }} />
        </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="fixed top-0 left-0 right-0 h-14 border-b bg-background/95 backdrop-blur z-40 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
            <h1 className="font-bold hidden md:block">Haibun Monitor</h1>
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

      <main className="container mx-auto pt-20 px-4">
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
        onChange={setCurrentTime}
        isPlaying={isPlaying}
        onPlayPause={togglePlay}
      />
    </div>
  )
};

const Badge = ({ children, variant }: any) => {
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
            variant === 'default' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : 
            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
        }`}>
            {children}
        </span>
    );
};

export default App
