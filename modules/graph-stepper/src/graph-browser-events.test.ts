import { feature, test } from '@haibun/core/build/lib/test/lib.js';
import { TWorld } from '@haibun/core/build/lib/defs.js';
import { EHaibunLogLevel } from '@haibun/core/build/lib/Logger.js';
import { RunGraph } from '@haibun/run-graph/build/run-graph.js';
import { GraphStepper } from './graph-stepper.js';
import { WebPlaywright } from '@haibun/web-playwright/build/WebPlaywright.js';
import { WebServerStepper } from '@haibun/web-server-express/build/web-server-stepper.js';

describe('graph browser events', () => {
    it('should add browser events to the graph', async () => {
        const steppers = [GraphStepper, WebPlaywright, WebServerStepper];
        const features = [
            feature('test feature', `
                feature: Test Feature
                scenario: Test Scenario
                Given I am on the page "http://localhost:8123/test.html"
            `),
        ];
        const world = {
            logger: {
                level: EHaibunLogLevel.info,
            },
        };
        const result = await test(steppers, features, world);
        expect(result.ok).toBe(true);
        const runGraph: RunGraph = world.shared.get('runGraph');
        expect(runGraph).toBeDefined();

        const siteNode = runGraph.nodes.find(n => n.type === 'site');
        expect(siteNode).toBeDefined();
        expect(siteNode.url).toBe('http://localhost:8123');

        const pageNode = runGraph.nodes.find(n => n.type === 'page');
        expect(pageNode).toBeDefined();
        expect(pageNode.url).toBe('http://localhost:8123/test.html');

        const accessNode = runGraph.nodes.find(n => n.type === 'access');
        expect(accessNode).toBeDefined();

        expect(runGraph.edges.some(e => e.source === siteNode.id && e.target === pageNode.id)).toBe(true);
        expect(runGraph.edges.some(e => e.source === pageNode.id && e.target === accessNode.id)).toBe(true);
        expect(runGraph.edges.some(e => e.target === accessNode.id)).toBe(true);
    });
});
