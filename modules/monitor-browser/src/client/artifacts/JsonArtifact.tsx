import { TJsonArtifact } from '@haibun/core/schema/protocol.js';
import React, { useState, useCallback } from 'react';

interface JsonArtifactProps {
  artifact: TJsonArtifact;
}

interface JsonNodeProps {
  keyName: string | number;
  value: unknown;
  depth: number;
  isArrayIndex?: boolean;
}

function getPrimitiveClassName(value: unknown): string {
  if (value === null) return 'text-gray-500 italic';
  if (typeof value === 'string') return 'text-green-700';
  if (typeof value === 'number') return 'text-red-600';
  if (typeof value === 'boolean') return 'text-purple-600';
  return 'text-blue-600';
}

function formatPrimitive(value: unknown): string {
  if (value === null) return '<null>';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function JsonNode({ keyName, value, depth, isArrayIndex }: JsonNodeProps) {
  const [isOpen, setIsOpen] = useState(depth < 4);
  const isComplex = typeof value === 'object' && value !== null;
  const marginLeft = depth * 16;

  const onToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setIsOpen(e.currentTarget.open);
  }, []);

  if (!isComplex) {
    return (
      <div className="json-line py-0.5 font-mono text-[10px]" style={{ marginLeft }}>
        <span className={`px-1 rounded ${isArrayIndex ? 'bg-blue-600 text-white' : 'bg-amber-700 text-white'}`}>
          {isArrayIndex ? `[${keyName}]` : `"${keyName}"`}
        </span>
        <span className="mx-1">:</span>
        <span className={getPrimitiveClassName(value)}>{formatPrimitive(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? (value as any[]).map((v, i) => [i, v] as const) : Object.entries(value as object);
  const preview = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <details open={isOpen} onToggle={onToggle} className="json-expandable" style={{ marginLeft }}>
      <summary className="cursor-pointer py-0.5 font-mono text-[10px] hover:bg-gray-100 list-none">
        <span className="inline-block w-4 text-gray-500">{isOpen ? '▼' : '▶'}</span>
        <span className={`px-1 rounded ${isArrayIndex ? 'bg-blue-600 text-white' : 'bg-purple-800 text-white'}`}>
          {isArrayIndex ? `[${keyName}]` : `"${keyName}"`}
        </span>
        {!isOpen && <span className="ml-2 text-gray-400">{preview}</span>}
      </summary>
      {isOpen && (
        <div className="border-l border-dashed border-gray-300">
          {entries.map(([k, v]) => (
            <JsonNode key={String(k)} keyName={k} value={v} depth={depth + 1} isArrayIndex={isArray} />
          ))}
        </div>
      )}
    </details>
  );
}

/**
 * JSON artifact with collapsible disclosure tree (disclosureJson pattern).
 */
export function JsonArtifact({ artifact }: JsonArtifactProps) {
  const json = artifact.json;
  const isArray = Array.isArray(json);
  const entries = isArray ? json.map((v, i) => [i, v] as const) : Object.entries(json);

  return (
    <div className="haibun-artifact-json bg-gray-50 border border-gray-200 rounded p-2">
      {entries.map(([k, v]) => (
        <JsonNode key={String(k)} keyName={k} value={v} depth={0} isArrayIndex={isArray} />
      ))}
    </div>
  );
}
