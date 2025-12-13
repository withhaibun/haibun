import React, { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import parse, { DOMNode, Element, domToReact } from 'html-react-parser';
import { THaibunEvent } from './types';

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
});

interface DocumentViewProps {
    events: THaibunEvent[];
}

export function DocumentView({ events }: DocumentViewProps) {
    const content = useMemo(() => {
        let md = '';
        let lastType: 'none' | 'prose' | 'technical' = 'none';

        events.forEach(e => {
            if (e.kind === 'lifecycle') {
                if (e.type === 'feature' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-3"></div>\n';
                    md += `\n\n# ${e.label}\n\n`;
                    lastType = 'prose';
                    return;
                }
                if (e.type === 'scenario' && e.stage === 'start') {
                    if (lastType === 'technical') md += '\n<div class="h-3"></div>\n';
                    md += `\n\n## ${e.label}\n\n`;
                    lastType = 'prose';
                    return;
                }
                if (e.type === 'step' && e.stage === 'end') {
                     // Heuristic: Technical steps (imperative actions) usually start with lowercase.
                     // Prose/Markdown (Headers, descriptions, Gherkin) usually start with Uppercase or special chars.
                     const isTechnical = /^[a-z]/.test(e.label);
                     
                     if (isTechnical) {
                        // Add spacer if entering a technical block from prose (and not start)
                        if (lastType !== 'technical' && md.length > 0) {
                            md += '\n<div class="h-3"></div>\n';
                        }

                        const depth = e.id ? e.id.split('.').length : 0;
                        const indent = Math.max(0, depth - 1) * 0.75;
                        const isNested = depth > 3;
                        const nestedStyle = isNested ? 'border-l-2 border-indigo-200 bg-indigo-50/50 py-1 pr-1' : '';
                        
                        // Using text-xs for smaller code font
                        md += `<div class="font-mono text-xs text-slate-600 my-0.5 leading-tight ${nestedStyle}" style="padding-left: ${indent}rem">${e.label}</div>\n`;
                        
                        lastType = 'technical';
                     } else {
                        // Add spacer if exiting technical block to prose
                        if (lastType === 'technical') {
                            md += '\n<div class="h-3"></div>\n';
                        }
                        
                        // Render as standard Markdown (Prose)
                        md += `\n\n${e.label}\n\n`;
                        lastType = 'prose';
                     }
                     return;
                }
            }
            // Logs disabled
        });
        return md;
    }, [events]);

    const reactContent = useMemo(() => {
        // 1. Render Markdown to HTML string
        const rawHtml = md.render(content);
        
        // 2. Sanitize HTML (allow style for indentation)
        const sanitizedHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['style'] });
    
        // 3. Parse HTML string to React Components
        return parse(sanitizedHtml, {
          replace: (domNode) => {
            if (domNode instanceof Element && domNode.attribs) {
              
              // Custom log styling (font-mono div)
              if (domNode.name === 'div' && domNode.attribs.class?.includes('font-mono')) {
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
      }, [content]);

    return (
        <div className="w-full bg-white text-slate-900 min-h-screen p-8 md:p-12">
            <div className="max-w-3xl mx-auto">
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
