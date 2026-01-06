import React, { useMemo, useRef, useEffect } from 'react';
import { MermaidArtifact } from './MermaidArtifact';
import { escapeLabel, sanitizeId, truncate } from './mermaid-utils';

/**
 * Quad data structure mirroring @haibun/v4 TQuad
 */
interface TQuad {
  subject: string;
  predicate: string;
  object: unknown;
  context?: string;
  timestamp?: number;
}

interface QuadGraphDiagramProps {
  quads: TQuad[];
  currentTime?: number;
  startTime?: number;
  /** Filter by context (e.g., 'credential', 'trust-registry', 'presentation') */
  contextFilter?: string[];
}

/**
 * Generates a mermaid flowchart from QuadStore quads.
 * Shows credential issuance chains, trust relationships, and data flows.
 * Highlights the current operation based on timeline position.
 */
export function QuadGraphDiagram({
  quads,
  currentTime,
  startTime = 0,
  contextFilter
}: QuadGraphDiagramProps) {
  const [selectedContexts, setSelectedContexts] = React.useState<Set<string>>(new Set(['shared']));
  const [layout, setLayout] = React.useState<'TD' | 'LR'>('TD');

  // Extract unique contexts from quads, organized hierarchically
  const { availableContexts, contextTree } = useMemo(() => {
    const contexts = new Set<string>();
    quads.forEach(q => {
      contexts.add(q.context || 'default');
    });
    const sorted = Array.from(contexts).sort();

    // Build tree: { parent: [children] }
    const tree: Record<string, string[]> = {};
    sorted.forEach(ctx => {
      if (ctx.includes('/')) {
        const parent = ctx.split('/')[0];
        if (!tree[parent]) tree[parent] = [];
        tree[parent].push(ctx);
      } else {
        if (!tree[ctx]) tree[ctx] = [];
      }
    });

    return { availableContexts: sorted, contextTree: tree };
  }, [quads]);

  // Toggle a context (with parent/child handling)
  const toggleContext = (ctx: string) => {
    setSelectedContexts(prev => {
      const next = new Set(prev);
      if (next.has(ctx)) {
        next.delete(ctx);
        // If deselecting a parent, also deselect children
        if (contextTree[ctx]) {
          contextTree[ctx].forEach(child => next.delete(child));
        }
      } else {
        next.add(ctx);
        // If selecting a parent, also select children
        if (contextTree[ctx]) {
          contextTree[ctx].forEach(child => next.add(child));
        }
      }
      return next;
    });
  };

  // Check if context matches selection (supports hierarchical matching)
  const matchesSelection = (quadContext: string | undefined): boolean => {
    const ctx = quadContext || 'default';
    if (selectedContexts.has('all')) return true;
    if (selectedContexts.has(ctx)) return true;
    // Check parent match (e.g., 'observation' matches 'observation/http')
    if (ctx.includes('/')) {
      const parent = ctx.split('/')[0];
      if (selectedContexts.has(parent)) return true;
    }
    return false;
  };

  const { mermaidSource, currentQuadIndex } = useMemo(() => {
    let filteredQuads = quads;

    // Apply prop-based context filter if provided
    if (contextFilter && contextFilter.length > 0) {
      filteredQuads = quads.filter(q =>
        !q.context || contextFilter.includes(q.context)
      );
    }

    // Apply UI-based multi-context selection
    // If no contexts selected, show all (treat empty same as 'all')
    if (!selectedContexts.has('all') && selectedContexts.size > 0) {
      filteredQuads = filteredQuads.filter(q => matchesSelection(q.context));
    }

    // Filter out meta quads unless specifically selected
    if (!selectedContexts.has('meta') && !selectedContexts.has('all')) {
      filteredQuads = filteredQuads.filter(q => q.context !== 'meta');
    }

    if (filteredQuads.length === 0) {
      return { mermaidSource: '', currentQuadIndex: -1 };
    }

    // Find current quad based on timeline position
    let currentIdx = -1;
    if (currentTime !== undefined) {
      const currentAbsoluteTime = startTime + currentTime;
      for (let i = filteredQuads.length - 1; i >= 0; i--) {
        const quadTime = filteredQuads[i].timestamp;
        if (quadTime && quadTime <= currentAbsoluteTime) {
          currentIdx = i;
          break;
        }
      }
    }

    // Build flowchart diagram with configurable layout
    let source = `graph ${layout}\n`;

    // Track unique nodes and their styles
    const nodes = new Map<string, { label: string; type: 'subject' | 'object' | 'predicate'; context?: string }>();
    const edges: { from: string; to: string; label: string; index: number }[] = [];

    // Process quads into graph structure
    filteredQuads.forEach((quad, idx) => {
      // Prefix node IDs with 'n_' to avoid collision with subgraph (context) names
      const subjectId = 'n_' + sanitizeId(quad.subject);
      const objectId = 'n_' + sanitizeId(stringifyObject(quad.object));

      // Add nodes with context tracking
      if (!nodes.has(subjectId)) {
        nodes.set(subjectId, {
          label: truncate(quad.subject, 25),
          type: 'subject',
          context: quad.context
        });
      }
      if (!nodes.has(objectId)) {
        nodes.set(objectId, {
          label: truncate(stringifyObject(quad.object), 25),
          type: 'object',
          // Object inherits context if not set (for grouping)
          context: quad.context
        });
      }

      // Add edge
      edges.push({
        from: subjectId,
        to: objectId,
        label: quad.predicate,
        index: idx,
      });
    });

    // Group nodes by context for subgraphs
    const nodesByContext = new Map<string, string[]>();
    nodes.forEach((_, id) => {
      const node = nodes.get(id);
      const ctx = node?.context || 'default';
      if (!nodesByContext.has(ctx)) nodesByContext.set(ctx, []);
      nodesByContext.get(ctx)?.push(id);
    });

    // Generate subgraphs
    nodesByContext.forEach((nodeIds, context) => {
      // Clean context name for mermaid ID
      // Clean context name for mermaid ID
      const safeContext = sanitizeId(context);
      // Always use subgraph for clarity if requested, or at least for named contexts
      // User requested "use subgraph for different contexts" - optimizing visibility
      source += `  subgraph ${safeContext} [${context}]\n`;

      nodeIds.forEach(id => {
        const node = nodes.get(id);
        if (node) {
          const shape = getNodeShape(node.type, id);
          source += `    ${id}${shape.open}${escapeLabel(node.label)}${shape.close}\n`;
        }
      });

      source += '  end\n';
    });

    // Generate edges
    edges.forEach((edge) => {
      const isActive = edge.index <= currentIdx;
      const isCurrent = edge.index === currentIdx;

      if (isCurrent) {
        source += `  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}\n`;
        source += `  style ${edge.from} fill:#0e7490\n`;
        source += `  style ${edge.to} fill:#0e7490\n`;
      } else if (isActive) {
        source += `  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}\n`;
      } else {
        source += `  ${edge.from} -.->|${escapeLabel(edge.label)}| ${edge.to}\n`;
      }
    });

    // Add context-based styling
    source += generateContextStyles(filteredQuads, nodes);

    return { mermaidSource: source, currentQuadIndex: currentIdx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quads, currentTime, startTime, contextFilter, selectedContexts.size, layout, ...Array.from(selectedContexts)]);

  if (!mermaidSource || quads.length === 0) {
    return <div className="text-slate-500 text-sm">No data operations to display</div>;
  }

  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll highlighted node into view
  useEffect(() => {
    if (currentQuadIndex < 0 || !containerRef.current) return;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      // Find highlighted nodes
      const nodes = containerRef.current.querySelectorAll('.node');
      for (const node of nodes) {
        const rect = node.querySelector('rect, polygon');
        if (rect) {
          const fill = rect.getAttribute('fill') || rect.getAttribute('style');
          if (fill && (fill.includes('0e7490') || fill.includes('14, 116, 144'))) {
            node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            break;
          }
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentQuadIndex, mermaidSource]);

  return (
    <div className="quad-graph-diagram" ref={containerRef}>
      <div className="flex gap-2 items-start mb-2 px-2 py-1 bg-slate-100 rounded border border-slate-200">
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-semibold text-slate-600">Contexts:</label>

          {/* Layout toggle */}
          <button
            onClick={() => setLayout(l => l === 'TD' ? 'LR' : 'TD')}
            className="px-2 py-0.5 text-xs border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100 font-medium"
            title="Toggle layout direction"
          >
            {layout === 'TD' ? '↓ TD' : '→ LR'}
          </button>

          {/* All toggle */}
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={selectedContexts.has('all')}
              onChange={() => {
                if (selectedContexts.has('all')) {
                  setSelectedContexts(new Set(['shared']));
                } else {
                  setSelectedContexts(new Set(['all']));
                }
              }}
              className="w-3 h-3"
            />
            <span style={{ color: 'black' }}>All</span>
          </label>

          {/* Context checkboxes grouped by parent */}
          {Object.keys(contextTree).map(parent => (
            <div key={parent} className="flex items-center gap-1">
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedContexts.has(parent)}
                  onChange={() => toggleContext(parent)}
                  className="w-3 h-3"
                />
                <span style={{ color: 'black' }}>{parent}</span>
              </label>
              {/* Children (if any) */}
              {contextTree[parent].length > 0 && (
                <span className="text-slate-400 text-[10px]">({contextTree[parent].length})</span>
              )}
            </div>
          ))}
        </div>

        <div className="flex-grow"></div>
        <div className="text-xs text-slate-400 font-mono">
          {currentQuadIndex >= 0 ? (
            <span>Op {currentQuadIndex + 1}/{quads.length}</span>
          ) : (
            <span>{quads.length} ops</span>
          )}
        </div>
      </div>

      <MermaidArtifact
        artifact={{
          artifactType: 'mermaid',
          source: mermaidSource,
          id: 'quad-graph',
          timestamp: Date.now(),
          kind: 'artifact',
          mimetype: 'text/x-mermaid'
          // biome-ignore lint/suspicious/noExplicitAny: complex union type
        } as any}
      />
    </div >
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

function stringifyObject(obj: unknown): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length <= 3) return `[${obj.map(v => String(v)).join(', ')}]`;
    return `[${obj.slice(0, 2).map(v => String(v)).join(', ')}, +${obj.length - 2}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    // Show first few key:value pairs for better detail visibility
    if (keys.length <= 4) {
      const pairs = keys.map(k => `${k}: ${truncateValue((obj as Record<string, unknown>)[k])}`);
      return pairs.join(', ');
    }
    // For larger objects, show first 3 keys and count
    const firstKeys = keys.slice(0, 3).map(k => k);
    return `${firstKeys.join(', ')}, +${keys.length - 3} more`;
  }
  return String(obj);
}

function truncateValue(val: unknown): string {
  if (typeof val === 'string') return val.length > 15 ? val.substring(0, 12) + '...' : val;
  if (typeof val === 'object' && val !== null) return '{...}';
  return String(val);
}

function getNodeShape(type: 'subject' | 'object' | 'predicate', id: string): { open: string; close: string } {
  // DIDs get hexagon shape
  if (id.startsWith('did_')) {
    return { open: '{{', close: '}}' };
  }
  // Credentials get rounded rectangle
  if (id.startsWith('cred_') || id.startsWith('pres_')) {
    return { open: '(', close: ')' };
  }
  // Status values get stadium shape
  if (id === 'active' || id === 'revoked') {
    return { open: '([', close: '])' };
  }
  // Default rectangle
  return { open: '[', close: ']' };
}

function generateContextStyles(quads: TQuad[], nodes: Map<string, unknown>): string {
  let styles = '';
  const contextColors: Record<string, string> = {
    'credential': '#3b82f6',      // Blue
    'trust-registry': '#10b981',  // Green
    'presentation': '#8b5cf6',    // Purple
  };

  // Group subjects by context
  const subjectContexts = new Map<string, string>();
  quads.forEach(q => {
    if (q.context && contextColors[q.context]) {
      const subjectId = sanitizeId(q.subject);
      if (!subjectContexts.has(subjectId)) {
        subjectContexts.set(subjectId, q.context);
      }
    }
  });

  // Apply context-based styling
  subjectContexts.forEach((context, id) => {
    if (nodes.has(id)) {
      const color = contextColors[context];
      styles += `  style ${id} stroke:${color},stroke-width:2px\n`;
    }
  });

  return styles;
}

/**
 * Generate mermaid flowchart source from quads (standalone helper)
 */
export function generateGraphFromQuads(quads: TQuad[], contextFilter?: string[]): string {
  let filteredQuads = quads.filter(q => q.subject !== 'meta');

  if (contextFilter && contextFilter.length > 0) {
    filteredQuads = filteredQuads.filter(q =>
      !q.context || contextFilter.includes(q.context)
    );
  }

  if (filteredQuads.length === 0) return '';

  let source = 'graph TD\n';
  const nodes = new Map<string, string>();

  filteredQuads.forEach((quad, idx) => {
    const subjectId = sanitizeId(quad.subject);
    const objectId = sanitizeId(stringifyObject(quad.object));

    if (!nodes.has(subjectId)) {
      const shape = getNodeShape('subject', subjectId);
      source += `  ${subjectId}${shape.open}${escapeLabel(truncate(quad.subject, 25))}${shape.close}\n`;
      nodes.set(subjectId, quad.subject);
    }
    if (!nodes.has(objectId)) {
      const shape = getNodeShape('object', objectId);
      source += `  ${objectId}${shape.open}${escapeLabel(truncate(stringifyObject(quad.object), 25))}${shape.close}\n`;
      nodes.set(objectId, stringifyObject(quad.object));
    }

    source += `  ${subjectId} -->|${escapeLabel(quad.predicate)}| ${objectId}\n`;
  });

  return source;
}
