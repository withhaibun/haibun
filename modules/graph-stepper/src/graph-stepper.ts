import { AStepper, IHasCycles } from '../../core/src/lib/astepper.js';
import { TWorld, TResolvedFeature, TFeatureStep, TStepActionResult, IStepperCycles } from '../../core/src/lib/defs.js';
import { RunGraph, TNode, TEdge } from '../../run-graph/src/run-graph.js';
import { WSServer } from '../../websocket-server/src/websocket-server.js';

export default class GraphStepper extends AStepper implements IHasCycles {
    runGraph: RunGraph;
    wsServer: WSServer;
    feature: TResolvedFeature;
    scenario: TFeatureStep;
    lastStep: TFeatureStep;

    async setWorld(world: TWorld, steppers: AStepper[]) {
        this.world = world;
        this.runGraph = new RunGraph(world);
        this.world.runtime.runGraph = this.runGraph;
        this.wsServer = new WSServer(8080);
    }

    cycles: IStepperCycles = {
        startFeature: async ({ resolvedFeature }: { resolvedFeature: TResolvedFeature }) => {
            this.feature = resolvedFeature;
            const featureNode = {
                id: resolvedFeature.path,
                type: 'feature',
                path: resolvedFeature.path,
            };
            this.runGraph.addNode(featureNode as TNode);
            this.wsServer.broadcast(JSON.stringify({ type: 'addNode', node: featureNode }));
            this.runGraph.addInstanceOf(featureNode.id, 'feature');
        },
        startScenario: async ({ scenario }: { scenario: TFeatureStep }) => {
            this.scenario = scenario;
            const scenarioNode = {
                id: scenario.in,
                type: 'scenario',
                name: scenario.in,
            };
            this.runGraph.addNode(scenarioNode as TNode);
            this.wsServer.broadcast(JSON.stringify({ type: 'addNode', node: scenarioNode }));
            const edge = {
                source: this.feature.path,
                target: scenario.in,
                type: 'contains',
                time: Date.now(),
            };
            this.runGraph.addEdge(edge as TEdge);
            this.wsServer.broadcast(JSON.stringify({ type: 'addEdge', edge }));
            this.runGraph.addInstanceOf(scenarioNode.id, 'scenario');
        },
        beforeStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
            const stepNode = {
                id: featureStep.in,
                type: 'step',
                in: featureStep.in,
            };
            this.runGraph.addNode(stepNode as TNode);
            this.wsServer.broadcast(JSON.stringify({ type: 'addNode', node: stepNode }));
            const containsEdge = {
                source: this.scenario.in,
                target: featureStep.in,
                type: 'contains',
                time: Date.now(),
            };
            this.runGraph.addEdge(containsEdge as TEdge);
            this.wsServer.broadcast(JSON.stringify({ type: 'addEdge', edge: containsEdge }));

            if (this.lastStep) {
                const precedesEdge = {
                    source: this.lastStep.in,
                    target: featureStep.in,
                    type: 'precedes',
                    time: Date.now(),
                };
                this.runGraph.addEdge(precedesEdge as TEdge);
                this.wsServer.broadcast(JSON.stringify({ type: 'addEdge', edge: precedesEdge }));
            }
            this.lastStep = featureStep;
            this.runGraph.addInstanceOf(stepNode.id, 'step');
        },
        afterStep: async ({ featureStep, actionResult }: { featureStep: TFeatureStep; actionResult: TStepActionResult }) => {
            if (featureStep.in.startsWith('waypoint')) {
                const waypointNode = {
                    id: featureStep.in,
                    type: 'waypoint',
                    name: featureStep.in,
                };
                this.runGraph.addNode(waypointNode as TNode);
                this.wsServer.broadcast(JSON.stringify({ type: 'addNode', node: waypointNode }));
                const generatesEdge = {
                    source: featureStep.in,
                    target: featureStep.in,
                    type: 'generates',
                    time: Date.now(),
                };
                this.runGraph.addEdge(generatesEdge as TEdge);
                this.wsServer.broadcast(JSON.stringify({ type: 'addEdge', edge: generatesEdge }));
                this.runGraph.addInstanceOf(waypointNode.id, 'waypoint');
            }
        },
        endExecution: async () => {
            const fs = await import('fs');
            fs.writeFileSync('files/run-graph.json', JSON.stringify(this.runGraph, null, 2));
        }
    };
}
