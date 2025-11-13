import { TWorld } from '../../core/src/lib/defs.js';

export class RunGraph {
    nodes: TNode[] = [];
    edges: TEdge[] = [];
    constructor(private world: TWorld) {
        this.addTaxonomy();
    }
    addNode(node: TNode) {
        this.nodes.push(node);
        this.world.logger.log(`added node ${node.id}`);
    }
    addEdge(edge: TEdge) {
        this.edges.push(edge);
        this.world.logger.log(`added edge ${edge.source} -> ${edge.target}`);
    }
    addInstanceOf(source: string, target: string) {
        const edge = {
            source,
            target,
            type: 'instanceOf',
            time: Date.now(),
        };
        this.addEdge(edge as TEdge);
    }
    private addTaxonomy() {
        const taxonomyNodes: TTaxonomyNode[] = [
            { id: 'feature', type: 'taxonomy', name: 'Feature' },
            { id: 'scenario', type: 'taxonomy', name: 'Scenario' },
            { id: 'step', type: 'taxonomy', name: 'Step' },
            { id: 'waypoint', type: 'taxonomy', name: 'Waypoint' },
            { id: 'event', type: 'taxonomy', name: 'Event' },
            { id: 'site', type: 'taxonomy', name: 'Site' },
            { id: 'page', type: 'taxonomy', name: 'Page' },
            { id: 'access', type: 'taxonomy', name: 'Access' },
        ];
        taxonomyNodes.forEach((node) => this.addNode(node));
    }
}

export type TNode = TFeatureNode | TScenarioNode | TStepNode | TWaypointNode | TEventNode | TTaxonomyNode | TSiteNode | TPageNode | TAccessNode;
export type TEdge = TContainsEdge | TPrecedesEdge | TGeneratesEdge | TInstanceOfEdge | THasEdge;

export type TSiteNode = {
    id: string;
    type: 'site';
    url: string;
};

export type TPageNode = {
    id: string;
    type: 'page';
    url: string;
};

export type TAccessNode = {
    id: string;
    type: 'access';
    url: string;
};

export type THasEdge = {
    source: string;
    target: string;
    type: 'has';
    time: number;
};

export type TTaxonomyNode = {
    id: string;
    type: 'taxonomy';
    name: string;
};

export type TInstanceOfEdge = {
    source: string;
    target: string;
    type: 'instanceOf';
    time: number;
};

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
