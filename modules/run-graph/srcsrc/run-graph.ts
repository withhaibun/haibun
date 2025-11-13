import { TWorld } from '@haibun/core/build/lib/defs.js';

export class RunGraph {
    nodes: TNode[] = [];
    edges: TEdge[] = [];
    constructor(private world: TWorld) { }
    addNode(node: TNode) {
        this.nodes.push(node);
        this.world.logger.log(`added node ${node.id}`);
    }
    addEdge(edge: TEdge) {
        this.edges.push(edge);
        this.world.logger.log(`added edge ${edge.source} -> ${edge.target}`);
    }
}

export type TNode = TFeatureNode | TScenarioNode | TStepNode | TWaypointNode | TEventNode;
export type TEdge = TContainsEdge | TPrecedesEdge | TGeneratesEdge;

export type TFeatureNode = {
    id: string;
    type: 'feature';
    path: string;
};

export type TScenarioNode = {
    id: string;
    type: 'scenario';
    name: string;
};

export type TStepNode = {
    id: string;
    type: 'step';
    in: string;
};

export type TWaypointNode = {
    id: string;
    type: 'waypoint';
    name: string;
};

export type TEventNode = {
    id: string;
    type: 'event';
    event: string;
};

export type TContainsEdge = {
    source: string;
    target: string;
    type: 'contains';
    time: number;
};

export type TPrecedesEdge = {
    source: string;
    target: string;
    type: 'precedes';
    time: number;
};

export type TGeneratesEdge = {
    source: string;
    target: string;
    type: 'generates';
    time: number;
};
