import { describe, it, expect } from 'vitest';
import GraphStepper from './graph-stepper.js';
import { TWorld, TResolvedFeature } from '../../core/src/lib/defs.js';
import Logger from '../../core/src/lib/Logger.js';

describe('GraphStepper', () => {
    it('should add a feature node on startFeature', async () => {
        const stepper = new GraphStepper();
        const world = { logger: new Logger({ level: 'info' }), runtime: {} } as TWorld;
        await stepper.setWorld(world, []);
        const resolvedFeature = { path: '/features/test.feature' } as TResolvedFeature;
        await stepper.cycles.startFeature({ resolvedFeature });
        const featureNode = stepper.runGraph.nodes.find((node) => node.id === '/features/test.feature');
        expect(featureNode).toBeDefined();
    });
});
