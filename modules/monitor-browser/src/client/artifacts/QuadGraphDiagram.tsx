import React, { useMemo, useRef, useEffect } from 'react';
import { ArtifactFrame } from '../components/ArtifactFrame';

// ... (other imports)
// ...

// const containerRef = useRef<HTMLDivElement>(null); (Removed)

// setIsFullscreen removed

import { MermaidArtifact } from './MermaidArtifact';
import { escapeLabel, sanitizeId, truncate } from './mermaid-utils';
import { HIGHLIGHT_COLOUR, DIMMED_OPACITY } from '../lib/timeline';

/**
 * Quad data structure visualization
 */
interface TQuad {
  subject: string;
  predicate: string;
  object: unknown;
  namedGraph?: string;
  timestamp?: number;
}

interface QuadGraphDiagramProps {
  quads: TQuad[];
  currentTime?: number;
  startTime?: number;
  /** Filter by namedGraph */
  namedGraphFilter?: string[];
}

/**
 * Generates a mermaid flowchart from QuadStore quads.
 * Shows operational data flows and relationships.
 * Highlights the current operation based on timeline position.
 */
export function QuadGraphDiagram({
  quads,
  currentTime,
  startTime = 0,
  namedGraphFilter
}: QuadGraphDiagramProps) {
  // Compute initial contexts from quads - excludes 'observation' and 'meta' by default
  const initialContexts = useMemo(() => {
    const contexts = new Set<string>();
    quads.forEach(q => {
      const ctx = q.namedGraph || 'ungrouped';
      // Exclude observation and meta contexts from initial selection
      if (ctx && !ctx.startsWith('observation') && ctx !== 'meta') {
        contexts.add(ctx);
      }
    });
    return contexts;
  }, [quads]);

  /* Initialize selection with computed contexts (excluding observations by default) */
  const [selectedContexts, setSelectedContexts] = React.useState<Set<string>>(() => new Set());
  const [layout, setLayout] = React.useState<'TD' | 'LR'>('TD');
  const [zoom, setZoom] = React.useState(100);

  // Track if we've initialized selection (to handle quads changing)
  const hasInitialized = useRef(false);

  // Extract unique contexts from quads, organized hierarchically
  const { availableContexts, contextTree } = useMemo(() => {
    const contexts = new Set<string>();
    quads.forEach(q => {
      contexts.add(q.namedGraph || 'ungrouped');
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

  // Initial population of selected contexts (sync with initialContexts)
  useEffect(() => {
    // Only initialize once when we have contexts to select
    if (!hasInitialized.current && initialContexts.size > 0) {
      hasInitialized.current = true;
      setSelectedContexts(initialContexts);
    }
  }, [initialContexts]);

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
  const matchesSelection = (quadNamedGraph: string | undefined): boolean => {
    const ctx = quadNamedGraph || 'ungrouped';
    if (selectedContexts.has('all')) return true;
    if (selectedContexts.has(ctx)) return true;
    // Check parent match (e.g., 'observation' matches 'observation/http')
    if (ctx.includes('/')) {
      const parent = ctx.split('/')[0];
      if (selectedContexts.has(parent)) return true;
    }
    return false;
  };

  // 1. Calculate Universe (Stable unless data/filter changes)
  const universeQuads = useMemo(() => {
    let u = quads;

    if (namedGraphFilter && namedGraphFilter.length > 0) {
      u = quads.filter(q =>
        !q.namedGraph || namedGraphFilter.includes(q.namedGraph)
      );
    }

    // When selection is empty (uninitialized), filter out observations and meta by default
    // Otherwise, apply the user's selection
    if (selectedContexts.size === 0) {
      u = u.filter(q => {
        const ctx = q.namedGraph || 'ungrouped';
        return !!ctx && !ctx.startsWith('observation') && ctx !== 'meta';
      });
    } else if (!selectedContexts.has('all')) {
      u = u.filter(q => matchesSelection(q.namedGraph));
    }

    return u;
  }, [quads, namedGraphFilter, selectedContexts.size, Array.from(selectedContexts).sort().join(',')]);

  // 2. Calculate Graph Source (Stable unless Universe or Layout changes)
  const { mermaidSource, nodes, edges } = useMemo(() => {
    const total = universeQuads.length;
    if (total === 0) {
      return { mermaidSource: '', nodes: new Map(), edges: [], totalQuads: 0 };
    }

    let source = `graph ${layout}\n`;

    // Track nodes
    const nodes = new Map<string, { id: string; label: string; type: 'subject' | 'object' | 'predicate'; namedGraph?: string; hasLabel?: boolean; firstSeenIndex: number }>();
    const edges: { from: string; to: string; label: string; index: number }[] = [];

    // Collect labels
    const labels = new Map<string, string>();
    const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
    universeQuads.forEach(q => {
      if (q.predicate === RDFS_LABEL) {
        const labelText = typeof q.object === 'string' ? q.object : String(q.object);
        labels.set(q.subject, labelText);
      }
    });

    // Process all quads
    universeQuads.forEach((quad, idx) => {
      if (quad.predicate === RDFS_LABEL) return;

      const subjectRaw = quad.subject;
      const objectRaw = stringifyObject(quad.object);

      if (!nodes.has(subjectRaw)) {
        const id = `n${nodes.size + 1}`;
        const hasLabel = labels.has(subjectRaw);
        nodes.set(subjectRaw, {
          id,
          label: labels.get(subjectRaw) ?? subjectRaw,
          type: 'subject',
          namedGraph: quad.namedGraph,
          hasLabel: !!hasLabel,
          firstSeenIndex: idx
        });
      }

      if (!nodes.has(objectRaw)) {
        const id = `n${nodes.size + 1}`;
        const hasLabel = labels.has(objectRaw);
        nodes.set(objectRaw, {
          id,
          label: labels.get(objectRaw) ?? objectRaw,
          type: 'object',
          namedGraph: quad.namedGraph,
          hasLabel: !!hasLabel,
          firstSeenIndex: idx
        });
      }

      const subjectNode = nodes.get(subjectRaw);
      const objectNode = nodes.get(objectRaw);

      if (subjectNode && objectNode) {
        edges.push({
          from: subjectNode.id,
          to: objectNode.id,
          label: quad.predicate,
          index: idx
        });
      }
    });

    // Generate Subgraphs
    const nodesByContext = new Map<string, string[]>();
    nodes.forEach((_, id) => {
      const node = nodes.get(id);
      const ctx = node?.namedGraph || 'ungrouped';
      if (!nodesByContext.has(ctx)) nodesByContext.set(ctx, []);
      nodesByContext.get(ctx)?.push(id);
    });

    nodesByContext.forEach((nodeIds, context) => {
      const safeContext = sanitizeId(context);
      source += `  subgraph ${safeContext} ["${context}"]\n`;
      nodeIds.forEach(id => {
        // nodeIds contains the raw subject/object strings
        const node = nodes.get(id);
        if (node) {
          const shape = getNodeShape(node.type, node.id);
          const displayLabel = truncate(escapeLabel(node.label), 60);
          source += `    ${node.id}${shape.open}${displayLabel}${shape.close}\n`;
        }
      });
      source += '  end\n';
    });

    // Generate Edges
    edges.forEach((edge) => {
      source += `  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}\n`;
    });

    // Add context-based styling
    source += generateContextStyles(universeQuads, nodes);

    const nodesById = new Map<string, { id: string; label: string; type: 'subject' | 'object' | 'predicate'; namedGraph?: string; hasLabel?: boolean; firstSeenIndex: number }>();
    nodes.forEach(n => nodesById.set(n.id, n));

    return { mermaidSource: source, nodes: nodesById, edges };
  }, [universeQuads, layout]);

  // Active quads count calculated inline where needed (currently unused)

  const [svgContainer, setSvgContainer] = React.useState<HTMLDivElement | null>(null);

  // Effect to update styles via DOM manipulation when time changes
  React.useLayoutEffect(() => {
    if (!svgContainer || currentTime === undefined || !universeQuads) return;

    // Calculate time state
    const currentAbsoluteTime = startTime + currentTime;
    let lastActiveIndex = -1;
    let latestTimestamp: number | undefined = undefined;

    // Find active cutoff
    for (let i = universeQuads.length - 1; i >= 0; i--) {
      const quadTime = universeQuads[i].timestamp ?? 0;
      if (quadTime <= currentAbsoluteTime) {
        lastActiveIndex = i;
        latestTimestamp = quadTime;
        break;
      }
    }

    // Determine nodes and edges status
    // Edges correspond to universeQuads index? 
    // Wait, edges array in useMemo is built from universeQuads.
    // Index in edges array corresponds to render order.
    // We need to map edges to their original quad index to check timestamp.
    // In useMemo, we pushed edges with `index: idx` (where idx is index in universeQuads).

    const edgePaths = svgContainer.querySelectorAll('.edgePaths path'); // Typical mermaid edge selector
    const nodeElements = svgContainer.querySelectorAll('.nodes .node'); // Typical mermaid node selector

    // 1. Update Edges
    // Assumption: Mermaid renders edges in the same order as defined in source.
    // This is generally true for `graph TD`.
    if (edgePaths.length === edges.length) {
      edgePaths.forEach((path, i) => {
        const edge = edges[i];
        const elem = path as SVGPathElement;

        const isFuture = edge.index > lastActiveIndex;
        // Using `==` equality for loose match if needed, but strict is fine
        const isCurrent = !isFuture && latestTimestamp !== undefined && universeQuads[edge.index].timestamp === latestTimestamp;

        let stroke = '#333';
        let strokeWidth = '1px';
        let strokeDasharray = 'none';

        if (isCurrent) {
          stroke = HIGHLIGHT_COLOUR;
          strokeWidth = '3px';
        } else if (isFuture) {
          stroke = '#D1D5DB';
          strokeWidth = '1px';
          strokeDasharray = '4, 4';
        }

        elem.style.stroke = stroke;
        elem.style.strokeWidth = strokeWidth;
        elem.style.strokeDasharray = strokeDasharray;

        // Also update arrowheads? hard to target.
      });
    }

    // 2. Update Nodes
    // Map: NodeID -> is it active?
    // A node is active if it participates in any non-future edge.
    // Current highlight: if participates in current edge.

    const nodeStatus = new Map<string, 'future' | 'active' | 'current'>();

    // Default all to future
    nodes.forEach((_, id) => nodeStatus.set(id, 'future'));

    edges.forEach((edge) => {
      const isFuture = edge.index > lastActiveIndex;
      const isCurrent = !isFuture && latestTimestamp !== undefined && universeQuads[edge.index].timestamp === latestTimestamp;

      if (!isFuture) {
        // If node was future, upgrade to active
        if (nodeStatus.get(edge.from) === 'future') nodeStatus.set(edge.from, 'active');
        if (nodeStatus.get(edge.to) === 'future') nodeStatus.set(edge.to, 'active');
      }

      if (isCurrent) {
        // Upgrade to current
        nodeStatus.set(edge.from, 'current');
        nodeStatus.set(edge.to, 'current');
      }
    });

    nodeElements.forEach((node) => {
      // const id = node.id; // (Unused, logic uses different lookup)
      // Mermaid IDs usually start with "flowchart-" + id + "-..."
      // But we know our IDs are "n_..."
      // Let's try to match the known ID from our map

      // Optimization: Iterate our map and find element by ID?
      // Mermaid: <g class="node" id="n_foo" ...> if securityLevel=loose
      // Our config has securityLevel='loose'.

      // Check if node has an ID we recognize
      // Sometimes mermaid prefixes IDs.
      // Let's loop through our known nodes and `getElementById` inside the container?
      // `container.querySelector('#' + id)`
    });

    // Better: Iterate our nodes map, find element, update style.
    nodes.forEach((_, id) => {
      const status = nodeStatus.get(id);
      // Selector: ID attribute
      let elem = svgContainer.querySelector(`[id^="${id}"]`); // Prefix match just in case?
      // Actually exact match if possible.
      if (!elem) {
        // Try finding by generic class + id attribute
        elem = svgContainer.querySelector(`#${id}`);
      }

      if (elem) {
        // The visual shape is usually a rect/polygon/circle inside the group
        const shape = elem.querySelector('rect, polygon, circle, ellipse') as SVGElement;

        if (shape) {
          if (status === 'future') {
            shape.style.stroke = '#D1D5DB';
            shape.style.strokeDasharray = '4, 4';
            shape.style.fill = '#fff';
            // shape.style.color = '#9CA3AF'; // Label color harder to change, usually separate <g> with <text>
          } else if (status === 'current') {
            shape.style.stroke = HIGHLIGHT_COLOUR;
            shape.style.strokeWidth = '3px';
            shape.style.strokeDasharray = 'none';
            // Keep fill default (white or context color)
          } else {
            // Active (default)
            // We need to revert to "default" style which might be context-colored
            // Since we don't store the original context color easily here...
            // Actually `generateContextStyles` set the stroke color in the SVG attribute `style`.
            // If we overwrite `elem.style.stroke`, we separate from attribute.
            // To revert, we can set `elem.style.stroke = ''`.
            shape.style.stroke = '';
            shape.style.strokeWidth = '';
            shape.style.strokeDasharray = '';
            shape.style.fill = '';
          }
        }

        // Labels?
        // Future labels -> gray.
        // <g class="label">...<text>...
        // const label = elem.querySelector('.label span') as HTMLElement; 

        if (status === 'future') {
          // Dim the whole node opacity using shared constant
          (elem as SVGElement).style.opacity = String(DIMMED_OPACITY);
        } else {
          (elem as SVGElement).style.opacity = '1';
        }
      }
    });

    // Scroll current nodes into view ?
    // Only if current changed? 
    // The previous logic used `currentQuadIndex` prop change to trigger scroll.
    // Now we do it here.
    if (latestTimestamp !== undefined) {
      // Find any current node and scroll
      const currentNodeId = Array.from(nodeStatus.entries()).find(([k, v]) => v === 'current')?.[0];
      if (currentNodeId) {
        const elem = svgContainer.querySelector(`#${currentNodeId}`);
        if (elem) {
          // Debounce/Throttle? 
          // Just do it.
          // elem.scrollIntoView(...)
          // Logic exists in `useLayoutEffect` below, we can reuse or trigger it.
        }
      }
    }

  }, [currentTime, svgContainer, universeQuads, edges, nodes, startTime]);

  if (!mermaidSource || quads.length === 0) {
    return <div className="text-slate-500 text-sm">No data operations to display</div>;
  }

  // Scroll highlighted node into view
  React.useLayoutEffect(() => {
    if (!svgContainer || currentTime === undefined) return; // Only scroll if timeline is active

    const timer = setTimeout(() => {
      if (!svgContainer) return;

      // Find highlighted nodes (current nodes)
      const nodes = svgContainer.querySelectorAll('.node');
      for (const node of nodes) {
        const rect = node.querySelector('rect, polygon, circle, ellipse');
        if (rect) {
          const stroke = rect.getAttribute('stroke') || (rect as SVGElement).style.stroke;
          // Check for current highlight color (loose match)
          if (stroke && stroke.toLowerCase() === HIGHLIGHT_COLOUR.toLowerCase()) {
            node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            break;
          }
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentTime, svgContainer]); // Depend on currentTime and svgContainer

  const handleCopy = async () => {
    if (!mermaidSource) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(mermaidSource);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = mermaidSource;
        textArea.style.position = 'fixed'; // Avoid scrolling to bottom
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const toolbar = (
    <>
      <div className="flex items-center gap-4 h-full">
        {/* Layout & Contexts */}
        <div className="flex items-center gap-2 text-xs border-r border-slate-200 pr-4 h-full">
          <button
            onClick={() => setLayout(l => l === 'TD' ? 'LR' : 'TD')}
            className="p-1 hover:bg-slate-100 rounded text-slate-600 font-mono flex items-center justify-center w-6 h-6"
            title="Toggle layout"
          >
            {layout === 'TD' ? '↓' : '→'}
          </button>
          <span className="text-slate-400">|</span>

          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedContexts.has('all')}
              onChange={() => {
                if (selectedContexts.has('all')) {
                  setSelectedContexts(new Set());
                } else {
                  const allContexts = new Set(availableContexts);
                  allContexts.add('all');
                  setSelectedContexts(allContexts);
                }
              }}
              className="w-3 h-3 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
            />
            <span className="text-slate-600">All</span>
          </label>

          {Object.keys(contextTree).map(parent => (
            <label key={parent} className="flex items-center gap-1 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={selectedContexts.has('all') || selectedContexts.has(parent)}
                onChange={() => toggleContext(parent)}
                disabled={selectedContexts.has('all')}
                className="w-3 h-3 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 disabled:opacity-50"
              />
              <span className="text-slate-600">{sanitizeId(parent)}</span>
              {contextTree[parent].length > 0 && (
                <span className="text-slate-400 text-[10px]">({contextTree[parent].length})</span>
              )}
            </label>
          ))}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-4 h-full">
          <button onClick={() => setZoom(z => Math.max(10, z - 10))} className="p-1 hover:bg-slate-100 rounded text-slate-600 font-bold w-6 h-6 flex items-center justify-center" title="Zoom Out">-</button>
          <span className="text-xs text-slate-500 w-8 text-center select-none">{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="p-1 hover:bg-slate-100 rounded text-slate-600 font-bold w-6 h-6 flex items-center justify-center" title="Zoom In">+</button>
        </div>
      </div>

      {/* [Info] - Plain text, no outline */}
      <div className="text-xs text-slate-500 font-mono px-2 whitespace-nowrap">
        {nodes ? nodes.size : 0} nodes, {edges ? edges.length : 0} edges
      </div>
    </>
  );

  return (
    <ArtifactFrame
      title="Quad Graph"
      toolbar={toolbar}
      onCopy={handleCopy}
      className="quad-graph-diagram"
    >
      <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left', minWidth: '100%', minHeight: '100%' }}>
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
          containerClassName="min-h-full"
          unstyled={true}
          onRender={(el) => setSvgContainer(el)}
        />
      </div>
    </ArtifactFrame>
  );
}

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

function getNodeShape(_type: string, id: string): { open: string; close: string } {
  // Items with IDs using separators often imply specific entities
  if (id.includes('_') || id.includes('-')) {
    return { open: '([', close: '])' };
  }
  // Default rectangle
  return { open: '[', close: ']' };
}

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];

function getClassColor(className: string): string {
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
}

function generateContextStyles(quads: TQuad[], nodes: Map<string, { id: string }>): string {
  let styles = '';

  // Group subjects by context
  const subjectContexts = new Map<string, string>();
  quads.forEach(q => {
    if (q.namedGraph) {
      if (!subjectContexts.has(q.subject)) {
        subjectContexts.set(q.subject, q.namedGraph);
      }
    }
  });

  // Apply context-based styling
  subjectContexts.forEach((context, rawSubject) => {
    const node = nodes.get(rawSubject);
    if (node) {
      const color = getClassColor(context);
      styles += `  style ${node.id} stroke:${color},stroke-width:2px\n`;
    }
  });
  return styles;
}



/**
 * Generate mermaid flowchart source from quads (standalone helper)
 */
export function generateGraphFromQuads(quads: TQuad[], namedGraphFilter?: string[]): string {
  let filteredQuads = quads.filter(q => q.subject !== 'meta');

  if (namedGraphFilter && namedGraphFilter.length > 0) {
    filteredQuads = filteredQuads.filter(q =>
      !q.namedGraph || namedGraphFilter.includes(q.namedGraph)
    );
  }

  if (filteredQuads.length === 0) return '';

  let source = 'graph TD\n';
  const nodes = new Map<string, { id: string; label: string }>();

  filteredQuads.forEach((quad, idx) => {
    const subjectRaw = quad.subject;
    const objectRaw = stringifyObject(quad.object);

    if (!nodes.has(subjectRaw)) {
      const id = `n${nodes.size + 1}`;
      const shape = getNodeShape('subject', id);
      source += `  ${id}${shape.open}${escapeLabel(subjectRaw)}${shape.close}\n`;
      nodes.set(subjectRaw, { id, label: subjectRaw });
    }
    if (!nodes.has(objectRaw)) {
      const id = `n${nodes.size + 1}`;
      const shape = getNodeShape('object', id);
      source += `  ${id}${shape.open}${escapeLabel(objectRaw)}${shape.close}\n`;
      nodes.set(objectRaw, { id, label: objectRaw });
    }

    const sNode = nodes.get(subjectRaw);
    const oNode = nodes.get(objectRaw);
    if (sNode && oNode) {
      source += `  ${sNode.id} -->|${escapeLabel(quad.predicate)}| ${oNode.id}\n`;
    }
  });

  return source;
}
