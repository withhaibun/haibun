import React, { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import parse, { DOMNode, Element, domToReact } from 'html-react-parser';
import { THaibunEvent, TArtifactEvent } from './types';
import { ArtifactRenderer } from './artifacts';

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
});

interface DocumentViewProps {
    events: THaibunEvent[];
}

export function DocumentView({ events }: DocumentViewProps) {
    // Group artifact events by their parent step ID
    // Also extract embedded artifacts from log events (legacy format)
    const artifactsByStep = useMemo(() => {
        const map = new Map<string, TArtifactEvent[]>();
        
        for (const e of events) {
            // Handle new-style artifact events
            if (e.kind === 'artifact') {
                // Extract parent step ID from artifact ID (e.g., "1.2.3.artifact.0" -> "1.2.3")
                const parts = e.id.split('.');
                const artifactIdx = parts.findIndex(p => p === 'artifact');
                let parentId = artifactIdx > 0 ? parts.slice(0, artifactIdx).join('.') : parts.slice(0, -1).join('.');
                // Normalize ID: remove brackets
                parentId = parentId.replace(/^\[|\]$/g, '');

                if (!map.has(parentId)) {
                    map.set(parentId, []);
                }
                map.get(parentId)!.push(e as TArtifactEvent);
            }
            
            // Handle legacy embedded artifacts (from payload or incidentDetails)
            const eventAny = e as any;
            const embeddedArtifacts = eventAny.payload?.artifacts || eventAny.incidentDetails?.artifacts;
            if (embeddedArtifacts && Array.isArray(embeddedArtifacts)) {
                const parentId = e.id;
                if (!map.has(parentId)) {
                    map.set(parentId, []);
                }
                // Convert legacy artifacts to TArtifactEvent format
                embeddedArtifacts.forEach((artifact: any, idx: number) => {
                    const artifactEvent: TArtifactEvent = {
                        id: `${parentId}.artifact.${idx}`,
                        timestamp: e.timestamp,
                        source: 'haibun',
                        kind: 'artifact',
                        artifactType: artifact.artifactType,
                        mimetype: artifact.mimetype || 'application/octet-stream',
                        ...('path' in artifact && { path: artifact.path }),
                        ...('json' in artifact && { json: artifact.json }),
                        ...('transcript' in artifact && { transcript: artifact.transcript }),
                        ...('durationS' in artifact && { durationS: artifact.durationS }),
                        ...('resolvedFeatures' in artifact && { resolvedFeatures: artifact.resolvedFeatures }),
                    } as TArtifactEvent;
                    map.get(parentId)!.push(artifactEvent);
                });
            }
        }
        return map;
    }, [events]);

    const content = useMemo(() => {
        let md = '';
        let lastType: 'none' | 'prose' | 'technical' = 'none';

        // We need to track the previous *rendered* event to determine relative depth changes for the symbol
        let previousRenderedDepth = 0;
        let previousRenderedId = '';

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            
            if (e.kind === 'lifecycle') {
                if (e.type === 'feature' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-3"></div>\n';
                    md += `\n\n# ${e.label}\n\n`;
                    const normalizedId = e.id.replace(/^\[|\]$/g, '');
                    const artifacts = artifactsByStep.get(normalizedId);
                    if (artifacts && artifacts.length > 0) {
                        md += `\n<div class="feature-artifacts" data-id="${normalizedId}"></div>\n`;
                    }
                    lastType = 'prose';
                    continue;
                }
                if (e.type === 'scenario' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-3"></div>\n';
                    md += `\n\n## ${e.label}\n\n`;
                    const normalizedId = e.id.replace(/^\[|\]$/g, '');
                    const artifacts = artifactsByStep.get(normalizedId);
                    if (artifacts && artifacts.length > 0) {
                        md += `\n<div class="feature-artifacts" data-id="${normalizedId}"></div>\n`;
                    }
                    lastType = 'prose';
                    continue;
                }
                // SWITCH TO START to fix ordering (Parents before Children)
                if (e.type === 'step' && e.stage === 'start') {
                     // Heuristic: Technical steps (imperative actions) usually start with lowercase.
                     const isTechnical = /^[a-z]/.test(e.label || '');
                     
                     if (isTechnical) {
                        // Add spacer if entering a technical block from prose
                        if (lastType !== 'technical' && md.length > 0) {
                            md += '\n<div class="h-3"></div>\n';
                        }
                        
                        // Check for instigator (look ahead for next step that starts with this ID)
                        let isInstigator = false;
                        for(let j=i+1; j<events.length; j++) {
                           const next = events[j];
                           if (next.id && next.id.startsWith(e.id + '.')) {
                               isInstigator = true;
                               break;
                           }
                           // If we hit a sibling or higher up, stop looking
                           if (next.id && !next.id.startsWith(e.id)) break; 
                        }

                        const depth = e.id ? e.id.split('.').length : 0;
                        const isNested = depth > 3;

                        // Serialize visual state into data attributes
                        // using 'log-row' class to trigger specific parser
                        const time = ((e.timestamp - (events[0]?.timestamp || 0))/1000).toFixed(3);
                        const actionName = (e as any).actionName || 'step'; // simplification

                        // Determine if we show the symbol (first child logic)
                        const showSymbol = previousRenderedId && previousRenderedDepth < depth;

                        // Check if this step has artifacts
                        const normalizedId = e.id.replace(/^\[|\]$/g, '');
                        const hasArtifacts = artifactsByStep.has(normalizedId);

                        md += `<div class="log-row font-mono text-xs text-slate-600 my-0.5 leading-tight" 
                                    data-depth="${depth}" 
                                    data-nested="${isNested}" 
                                    data-instigator="${isInstigator}" 
                                    data-show-symbol="${showSymbol}"
                                    data-id="${normalizedId}"
                                    data-time="${time}"
                                    data-action="${actionName}"
                                    data-has-artifacts="${hasArtifacts}">${e.label}</div>\n`;
                        
                        lastType = 'technical';
                        previousRenderedDepth = depth;
                        previousRenderedId = e.id || '';
                     } else {
                        // Prose Step
                        if (lastType === 'technical') {
                            md += '\n<div class="h-3"></div>\n';
                        }
                        md += `\n\n${e.label}\n\n`;
                        lastType = 'prose';
                     }
                     continue;
                }
            }
        }
        return md;
    }, [events, artifactsByStep]);

    const reactContent = useMemo(() => {
        // 1. Render Markdown to HTML string
        const rawHtml = md.render(content);
        
        // 2. Sanitize HTML (allow data-* attributes and style)
        const sanitizedHtml = DOMPurify.sanitize(rawHtml, { 
            ADD_ATTR: ['style', 'data-depth', 'data-nested', 'data-instigator', 'data-show-symbol', 'data-id', 'data-time', 'data-action', 'data-has-artifacts'],
            ADD_TAGS: ['div'] // Ensure div is allowed
        });
    
        // 3. Parse HTML string to React Components
        return parse(sanitizedHtml, {
          replace: (domNode) => {
            if (domNode instanceof Element && domNode.attribs) {
              
              // Feature/Scenario Artifacts
              if (domNode.name === 'div' && domNode.attribs.class === 'feature-artifacts') {
                   const stepId = domNode.attribs['data-id'];
                   const stepArtifacts = artifactsByStep.get(stepId) || [];
                   return (
                       <div className="my-4 p-4 border rounded bg-slate-50">
                           {stepArtifacts.map((artifact, idx) => (
                               <div key={`${stepId}-artifact-${idx}`} className="mb-4 last:mb-0">
                                   <div className="text-xs text-slate-500 mb-1">📎 {artifact.artifactType}</div>
                                   <ArtifactRenderer artifact={artifact} />
                               </div>
                           ))}
                       </div>
                   );
              }

              // Custom log row rendering with Rail System (Replicates App.tsx visuals)
              if (domNode.name === 'div' && domNode.attribs.class?.includes('log-row')) {
                  const depth = parseInt(domNode.attribs['data-depth'] || '0');
                  const isNested = domNode.attribs['data-nested'] === 'true';
                  const isInstigator = domNode.attribs['data-instigator'] === 'true';
                  const showSymbol = domNode.attribs['data-show-symbol'] === 'true';
                  const stepId = domNode.attribs['data-id'];
                  const hasArtifacts = domNode.attribs['data-has-artifacts'] === 'true';
                  const stepArtifacts = hasArtifacts && stepId ? artifactsByStep.get(stepId) || [] : [];

                  return (
                      <div className={domNode.attribs.class + " flex flex-col"}>
                          <div className="flex items-stretch break-all">
                               <span className="mx-1 text-slate-800 dark:text-slate-600 self-start mt-1">｜</span>

                               {/* Content + Rail */}
                               <div className="flex-1 flex items-stretch">
                                   {/* Indentation Spacer */}
                                   <div style={{ width: `${Math.max(0, depth - 4) * 0.75}rem` }} className="shrink-0" />
                                    
                                   {/* Rail Container */}
                                   {(isNested || isInstigator) && (
                                        <div className="relative w-4 shrink-0 mr-1">
                                            {/* Full Line for Nested Steps */}
                                            {isNested && (
                                                <div className="absolute top-0 -bottom-[1px] right-[3px] w-px bg-indigo-500" />
                                            )}
                                            
                                            {/* Start Marker Line for Top-Level Instigators */}
                                            {isInstigator && !isNested && (
                                                <div className="absolute top-[6px] -bottom-[1px] right-[3px] w-px bg-indigo-500" />
                                            )}

                                            {/* Horizontal Bar Symbol (First Child) */}
                                            {isNested && showSymbol && (
                                                <div className="absolute top-0 right-[3px] w-2.5 h-px bg-indigo-500" />
                                            )}
                                        </div>
                                   )}

                                 <div className="flex-1 py-1">
                                     {domToReact(domNode.children as DOMNode[])}
                                 </div>
                              </div>
                          </div>
                          
                          {/* Inline Artifacts */}
                          {stepArtifacts.length > 0 && (
                              <div className="ml-8 my-2 space-y-2">
                                  {stepArtifacts.map((artifact, idx) => (
                                      <div key={`${stepId}-artifact-${idx}`} className="border border-slate-200 rounded p-2 bg-slate-50">
                                          <div className="text-xs text-slate-500 mb-1">📎 {artifact.artifactType}</div>
                                          <ArtifactRenderer artifact={artifact} />
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  );
              }
              
              // Old generic mono handler (fallback or for other elements)
              if (domNode.name === 'div' && domNode.attribs.class?.includes('font-mono') && !domNode.attribs.class?.includes('log-row')) {
                  return (
                      <div 
                        className={domNode.attribs.class}
                        style={domNode.attribs.style ? { paddingLeft: domNode.attribs.style.split(':')[1] } : undefined}
                      >
                          {domToReact(domNode.children as DOMNode[])}
                      </div>
                  );
              }

              if (domNode.name === 'a') {
                return (
                  <a 
                    href={domNode.attribs.href} 
                    className="text-blue-600 hover:text-blue-800 hover:underline underline-offset-4" 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    {domToReact(domNode.children as DOMNode[])} 
                  </a>
                );
              }
              
              if (domNode.name === 'h1') {
                  return <h1 className="text-3xl font-bold mt-6 mb-4 pb-2 border-b border-border">{domToReact(domNode.children as DOMNode[])}</h1>;
              }
              if (domNode.name === 'h2') {
                  // Fixed text color to slate-900 (black in light mode) instead of primary
                  return <h2 className="text-2xl font-semibold mt-6 mb-3 text-slate-900">{domToReact(domNode.children as DOMNode[])}</h2>;
              }
               if (domNode.name === 'h3') {
                  return <h3 className="text-xl font-semibold mt-4 mb-2">{domToReact(domNode.children as DOMNode[])}</h3>;
              }
              if (domNode.name === 'h4') {
                  return <h4 className="text-lg font-bold mt-4 mb-1">{domToReact(domNode.children as DOMNode[])}</h4>;
              }
              if (domNode.name === 'ul') {
                  return <ul className="list-disc pl-6 mb-4 space-y-1">{domToReact(domNode.children as DOMNode[])}</ul>;
              }
              if (domNode.name === 'ol') {
                  return <ol className="list-decimal pl-6 mb-4 space-y-1">{domToReact(domNode.children as DOMNode[])}</ol>;
              }
              if (domNode.name === 'li') {
                  return <li className="leading-relaxed">{domToReact(domNode.children as DOMNode[])}</li>;
              }
              if (domNode.name === 'blockquote') {
                  return <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic text-muted-foreground my-4">{domToReact(domNode.children as DOMNode[])}</blockquote>;
              }
               if (domNode.name === 'code') {
                   // Check if parent is pre? specialized handling if needed, or just style inline code
                   // Simple inline code style
                   const isBlock = domNode.parent && (domNode.parent as Element).name === 'pre';
                   if (!isBlock) {
                       return <code className="bg-slate-100 px-1 py-0.5 rounded-sm text-xs font-mono text-slate-800 border border-slate-200">{domToReact(domNode.children as DOMNode[])}</code>;
                   }
              }
              if (domNode.name === 'pre') {
                  return <pre className="bg-muted/50 p-4 rounded-lg overflow-x-auto my-4 text-sm font-mono">{domToReact(domNode.children as DOMNode[])}</pre>;
              }

              if (domNode.name === 'table') {
                return (
                  <div className="overflow-x-auto my-4 border rounded-lg">
                    <table className="w-full text-sm text-left">
                      {domToReact(domNode.children as DOMNode[])}
                    </table>
                  </div>
                );
              }
            }
          },
        });
      }, [content, artifactsByStep]);

    return (
        <div className="w-full bg-white text-slate-900 min-h-screen p-4 md:p-8">
            <div className="w-full">
                <div className="prose prose-slate max-w-none font-serif leading-relaxed text-slate-900 
                    prose-headings:font-bold prose-headings:text-slate-900 
                    prose-h1:text-3xl prose-h1:mb-6 prose-h1:border-b prose-h1:border-slate-200 prose-h1:pb-2
                    prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4
                    prose-p:mb-4 prose-p:text-base md:prose-p:text-lg
                    prose-code:text-slate-800 prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:font-mono prose-code:text-sm
                    prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-200 prose-pre:text-slate-800
                    prose-blockquote:border-l-4 prose-blockquote:border-slate-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-slate-600
                ">
                    {reactContent}
                </div>
            </div>
        </div>
    );
}


