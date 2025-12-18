import React, { useMemo, useState } from 'react';
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
    // Group artifact events by their parent step ID
    const { artifactsByStep, allArtifactIds } = useMemo(() => {
        const map = new Map<string, TArtifactEvent[]>();
        const allIds = new Set<string>();
        
        for (const e of events) {
            if (e.kind === 'artifact') {
                allIds.add(e.id);
                // Extract parent step ID: handle both "id.artifact.N" and raw paths
                let parentId = '';
                if (e.id.includes('.artifact.')) {
                    parentId = e.id.split('.artifact.')[0];
                } else {
                    // Fallback: try to find a parent by removing the last parts
                    const parts = e.id.split('.');
                    parentId = parts.length > 1 ? parts.slice(0, -1).join('.') : e.id;
                }
                parentId = parentId.replace(/^\[|\]$/g, '');

                if (!map.has(parentId)) map.set(parentId, []);
                map.get(parentId)!.push(e as TArtifactEvent);
            }
            
            // Handle legacy embedded artifacts
            const eventAny = e as any;
            const embeddedArtifacts = eventAny.payload?.artifacts || eventAny.incidentDetails?.artifacts;
            if (embeddedArtifacts && Array.isArray(embeddedArtifacts)) {
                const parentId = e.id.replace(/^\[|\]$/g, '');
                if (!map.has(parentId)) map.set(parentId, []);
                embeddedArtifacts.forEach((artifact: any, idx: number) => {
                    const id = `${parentId}.artifact.${idx}`;
                    allIds.add(id);
                    map.get(parentId)!.push({
                        id,
                        timestamp: e.timestamp,
                        source: 'haibun',
                        kind: 'artifact',
                        artifactType: artifact.artifactType,
                        mimetype: artifact.mimetype || 'application/octet-stream',
                        ...artifact
                    } as TArtifactEvent);
                });
            }
        }
        return { artifactsByStep: map, allArtifactIds: allIds };
    }, [events]);

    const content = useMemo(() => {
        let md = '';
        let lastType: 'none' | 'prose' | 'technical' = 'none';
        let previousRenderedDepth = 0;
        let previousRenderedId = '';
        const claimedArtifactIds = new Set<string>();

        const claimArtifacts = (id: string, excludeTypes: string[] = []) => {
            const normalizedId = id.replace(/^\[|\]$/g, '');
            const artifacts = artifactsByStep.get(normalizedId) || [];
            const unclaimed = artifacts.filter(a => !claimedArtifactIds.has(a.id) && !excludeTypes.includes(a.artifactType));
            if (unclaimed.length > 0) {
                unclaimed.forEach(a => claimedArtifactIds.add(a.id));
                return unclaimed.map(a => a.id).join(',');
            }
            return '';
        };

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            
            if (e.kind === 'artifact') {
                if (!claimedArtifactIds.has(e.id)) {
                    claimedArtifactIds.add(e.id);
                    md += `<div class="standalone-artifact" data-id="${e.id}"></div>\n`;
                }
                continue;
            }

            if (e.kind === 'lifecycle') {
                if (e.type === 'feature' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-1"></div>\n';
                    md += `\n\n# ${e.label}\n\n`;
                    const unclaimedIds = claimArtifacts(e.id, ['video']);
                    if (unclaimedIds) {
                        md += `\n<div class="feature-artifacts" data-ids="${unclaimedIds}"></div>\n`;
                    }
                    lastType = 'prose';
                    continue;
                }
                if (e.type === 'scenario' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-1"></div>\n';
                    md += `\n\n## ${e.label}\n\n`;
                    const unclaimedIds = claimArtifacts(e.id, ['video']);
                    if (unclaimedIds) {
                        md += `\n<div class="feature-artifacts" data-ids="${unclaimedIds}"></div>\n`;
                    }
                    lastType = 'prose';
                    continue;
                }
                if (e.type === 'step' && e.stage === 'start') {
                     const isTechnical = /^[a-z]/.test(e.label || '');
                     
                     if (isTechnical) {
                        if (lastType !== 'technical' && md.length > 0) md += '\n<div class="h-1"></div>\n';
                        
                        let isInstigator = false;
                        for(let j=i+1; j<events.length; j++) {
                           const next = events[j];
                           if (next.id && next.id.startsWith(e.id + '.')) {
                               isInstigator = true;
                               break;
                           }
                           if (next.id && !next.id.startsWith(e.id)) break; 
                        }

                        const depth = e.id ? e.id.split('.').length : 0;
                        const isNested = depth > 3;
                        const time = ((e.timestamp - (events[0]?.timestamp || 0))/1000).toFixed(3);
                        const actionName = (e as any).actionName || 'step';
                        const showSymbol = previousRenderedId && previousRenderedDepth < depth;
                        const normalizedId = e.id.replace(/^\[|\]$/g, '');
                        const unclaimedIds = claimArtifacts(normalizedId, ['video']);

                        md += `<div class="log-row font-mono text-[11px] text-slate-500 my-0 leading-tight" 
                                    data-depth="${depth}" 
                                    data-nested="${isNested}" 
                                    data-instigator="${isInstigator}" 
                                    data-show-symbol="${showSymbol}"
                                    data-id="${normalizedId}"
                                    data-ids="${unclaimedIds}"
                                    data-time="${time}"
                                    data-action="${actionName}"
                                    data-has-artifacts="${!!unclaimedIds}">${e.label}</div>\n`;
                        
                        lastType = 'technical';
                        previousRenderedDepth = depth;
                        previousRenderedId = e.id || '';
                     } else {
                        if (lastType === 'technical') md += '\n<div class="h-1"></div>\n';
                        md += `\n\n${e.label}\n\n`;
                        const unclaimedIds = claimArtifacts(e.id, ['video']);
                        if (unclaimedIds) {
                            md += `\n<div class="feature-artifacts" data-ids="${unclaimedIds}"></div>\n`;
                        }
                        lastType = 'prose';
                     }
                     continue;
                }
            }
        }

        return md;
    }, [events, artifactsByStep, allArtifactIds]);

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
              
              // Feature/Scenario/Step Artifacts
              if (domNode.name === 'div' && domNode.attribs.class === 'feature-artifacts') {
                   const stepId = domNode.attribs['data-id']; // keep for keys
                   const idString = domNode.attribs['data-ids'];
                   if (!idString) return null;
                   
                   const artifactIds = idString.split(',');
                   const stepArtifacts = artifactIds.map(id => events.find(e => e.id === id)).filter(Boolean) as TArtifactEvent[];
                   
                   if (stepArtifacts.length === 0) return null;

                   return (
                       <div className="my-2 space-y-1">
                           {stepArtifacts.map((artifact, idx) => (
                               <ArtifactCaption key={`${stepId}-artifact-${idx}`} artifact={artifact} />
                           ))}
                       </div>
                   );
              }

              // Standalone Artifacts (at end of document)
              if (domNode.name === 'div' && domNode.attribs.class === 'standalone-artifact') {
                  const id = domNode.attribs['data-id'];
                  const artifact = events.find(ev => ev.id === id) as TArtifactEvent;
                  if (!artifact) return null;
                  return <ArtifactCaption key={`standalone-${id}`} artifact={artifact} />;
              }

              // Custom log row rendering with Rail System (Replicates App.tsx visuals)
              if (domNode.name === 'div' && domNode.attribs.class?.includes('log-row')) {
                  const depth = parseInt(domNode.attribs['data-depth'] || '0');
                  const isNested = domNode.attribs['data-nested'] === 'true';
                  const isInstigator = domNode.attribs['data-instigator'] === 'true';
                  const showSymbol = domNode.attribs['data-show-symbol'] === 'true';
                  const stepId = domNode.attribs['data-id'];
                  const idString = domNode.attribs['data-ids'];
                  
                  const stepArtifacts = idString ? idString.split(',').map(id => events.find(e => e.id === id)).filter(Boolean) as TArtifactEvent[] : [];

                  return (
                      <div className={domNode.attribs.class + " flex flex-col"}>
                          <div className="flex items-stretch break-all">
                               <span className="mx-1 text-slate-400 self-start mt-1">｜</span>

                               {/* Content + Rail */}
                               <div className="flex-1 flex items-stretch">
                                   {/* Indentation Spacer */}
                                   <div style={{ width: `${Math.max(0, depth - 4) * 0.75}rem` }} className="shrink-0" />
                                    
                                   {/* Rail Container */}
                                   {(isNested || isInstigator) && (
                                        <div className="relative w-4 shrink-0 mr-1">
                                            {/* Full Line for Nested Steps */}
                                            {isNested && (
                                                <div className="absolute top-0 -bottom-[1px] right-[3px] w-px bg-slate-200" />
                                            )}
                                            
                                            {/* Start Marker Line for Top-Level Instigators */}
                                            {isInstigator && !isNested && (
                                                <div className="absolute top-[6px] -bottom-[1px] right-[3px] w-px bg-slate-200" />
                                            )}

                                            {/* Horizontal Bar Symbol (First Child) */}
                                            {isNested && showSymbol && (
                                                <div className="absolute top-0 right-[3px] w-2.5 h-px bg-slate-200" />
                                            )}
                                        </div>
                                   )}

                                 <div className="flex-1 py-0.5 text-slate-600">
                                     {domToReact(domNode.children as DOMNode[])}
                                 </div>
                              </div>
                          </div>
                          
                          {/* Inline Artifacts */}
                          {stepArtifacts.length > 0 && (
                              <div className="ml-8 my-1 space-y-3">
                                  {stepArtifacts.map((artifact, idx) => (
                                      <ArtifactCaption key={`${stepId}-artifact-${idx}`} artifact={artifact} />
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
                ">
                    {reactContent}
                </div>
                <style>{`
                    .prose blockquote p:first-of-type::before {
                        content: none;
                    }
                    .prose blockquote p:last-of-type::after {
                        content: none;
                    }
                `}</style>
            </div>
        </div>
    );
}




function ArtifactCaption({ artifact }: { artifact: TArtifactEvent }) {
    const label = artifact.artifactType || 'artifact';
    const isHiddenByDefault = label === 'mermaid' || label === 'resolvedFeatures' || label === 'video-start' || label === 'video';
    const [isOpen, setIsOpen] = useState(!isHiddenByDefault);
    
    const path = (artifact as any).path || artifact.id;
    const filename = path.split('/').pop();

    return (
        <div className="my-4 first:mt-2 last:mb-2 font-sans">
            <div className={`transition-all duration-200 border-l-2 ${isOpen ? 'border-slate-300 bg-slate-50/50' : 'border-slate-200 hover:border-slate-300 bg-transparent'} p-3`}>
                <div 
                    className="flex items-center gap-2 cursor-pointer select-none group"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span className="text-[10px] w-3 text-slate-400 group-hover:text-slate-600 transition-colors flex items-center justify-center">
                        {isOpen ? '▼' : '▶'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                        <span className="font-mono text-slate-600 font-medium">{label}:</span> <span className="text-slate-400 ml-1">{filename}</span>
                    </span>
                </div>
                
                {isOpen && (
                    <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-200 font-sans">
                        <ArtifactRenderer artifact={artifact} displayMode="document" />
                    </div>
                )}
            </div>
        </div>
    );
}
