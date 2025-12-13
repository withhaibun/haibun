
import React from 'react';
import { useRef, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Play, SkipForward, ArrowRight, XCircle, RefreshCw, Send } from 'lucide-react';

interface DebuggerProps {
    prompt: {
        id: string;
        message: string;
        options?: string[];
    } | null;
    onSubmit: (value: string) => void;
}

export function Debugger({ prompt, onSubmit }: DebuggerProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input when prompt changes and input is present
    useEffect(() => {
        if (prompt?.options?.includes('*') && inputRef.current) {
            inputRef.current.focus();
        }
    }, [prompt]);

    if (!prompt) return null;

    const hasInput = prompt.options?.includes('*');
    const showButtons = !hasInput || prompt.options?.length && prompt.options.length > 1;

    // Helper to render button based on option string
    const renderButton = (opt: string) => {
        const lower = opt.toLowerCase();
        
        // Skip specialized options if handled elsewhere (like *)
        if (opt === '*') return null;

        let icon = <ArrowRight className="h-3 w-3 mr-1" />;
        let variant: "secondary" | "default" | "destructive" | "outline" | "ghost" | "link" = "secondary";
        let className = "h-7 px-2 text-xs"; // Dense "New York" style

        if (lower.includes('continue')) {
            icon = <Play className="h-3 w-3 mr-1" />;
            variant = "default";
            className += " bg-green-600 hover:bg-green-700 text-white";
        } else if (lower.includes('fail')) {
            icon = <XCircle className="h-3 w-3 mr-1" />;
            variant = "destructive";
        } else if (lower.includes('retry')) {
            icon = <RefreshCw className="h-3 w-3 mr-1" />;
            variant = "outline";
        } else if (lower.includes('next')) {
            icon = <SkipForward className="h-3 w-3 mr-1" />;
        }

        return (
            <Button 
                key={opt}
                variant={variant} 
                className={className}
                onClick={() => onSubmit(opt)} 
                title={opt}
            >
                {icon}
                {opt}
            </Button>
        );
    };

    return (
        <div className="fixed top-4 right-4 bg-popover text-popover-foreground border border-border/40 rounded-sm shadow-md p-3 z-50 w-80 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">Debugger Active</h3>
                <div className="h-1.5 w-1.5 bg-yellow-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
            </div>
            
            <div className="bg-muted/50 p-2 rounded-sm text-xs font-mono mb-3 break-all border border-border/20">
                {prompt.message}
            </div>

            {hasInput && (
                <div className="flex gap-2 mb-3">
                    <input 
                        ref={inputRef}
                        type="text" 
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                if (val.trim()) {
                                    onSubmit(val);
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }
                        }}
                        className="flex-1 px-2 py-1 text-xs border rounded-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Enter command..."
                    />
                     <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0"
                        onClick={() => {
                            if (inputRef.current?.value) {
                                onSubmit(inputRef.current.value);
                                inputRef.current.value = '';
                            }
                        }}
                    >
                        <Send className="h-3 w-3" />
                    </Button>
                </div>
            )}

            {showButtons && (
                <div className="flex flex-wrap gap-2 justify-end">
                    {prompt.options?.map(opt => renderButton(opt))}
                    {/* Fallback if no options are standard but not star? Usually options are explicit. */}
                </div>
            )}
        </div>
    );
}
