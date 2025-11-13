import { describe, it, expect } from 'vitest';
import { RunGraph } from './run-graph.js';
import { TWorld } from '../../core/src/lib/defs.js';
import Logger from '../../core/src/lib/Logger.js';

describe('RunGraph', () => {
    it('should add a node', () => {
        const world = { logger: new Logger({ level: 'info' }) } as TWorld;
        const runGraph = new RunGraph(world);
        const node = { id: '1', type: 'feature', path: '/features/test.feature' };
        runGraph.addNode(node);
        expect(runGraph.nodes).toContain(node);
    });

    it('should add an edge', () => {
        const world = { logger: new Logger({ level: 'info' }) } as TWorld;
        const runGraph = new RunGraph(world);
        const edge = { source: '1', target: '2', type: 'contains', time: 0 };
        runGraph.addEdge(edge);
        expect(runGraph.edges).toContain(edge);
    });
});
