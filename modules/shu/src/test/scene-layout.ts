/**
 * A graph scene's layout without a browser or WebGL. The quads are a small mailbox as a store serves them: five messages
 * dated days to a year apart, one replying to another and two referencing others, each with its body, and two people that
 * an edge doesn't touch. `SceneLayout` composes the scene's own layout parts as the scene does: the data pipeline, the render
 * type of the view, the group cells, the force placement, and the boxes the enclosures draw. A repaint places the new nodes of
 * a feed, and a relayout places every node again, as the scene's two paths do.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL, HAS_BODY_EDGE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { DataPipeline } from "../page/graph/pipelines/data-pipeline.js";
import { buildRenderTypeRegistry, type RenderType } from "../page/graph/components/render-type.js";
import { visibleGraphModel } from "../page/graph/derivations/scene-data.js";
import { seqNodesOf, type SeqNode } from "../page/graph/derivations/sequence-model.js";
import { forceLayout } from "../page/graph/derivations/polymorphic-layout.js";
import { ENCLOSURE_PAD, GROUP_GAP, groupBounds, groupKeyOf, shelfPack, type GroupAnchor, type GroupBox, type GroupKeyMode } from "../page/graph/derivations/grouping.js";
import { groupCellSize } from "../page/graph/derivations/group-grid.js";
import { chipTextHeight, collideRadius } from "../page/graph/derivations/layout-forces.js";
import type { GanttScale, GanttTarget } from "../page/graph/derivations/gantt-layout.js";
import type { Adornment } from "../page/graph/derivations/graph-layout.js";
import { VIEW, type ViewType } from "../page/graph/domains/views.js";
import { isPlaced, linkEndId, type FGLink, type FGNode, type XYZ } from "../page/graph/domains/graph-types.js";
import type { GraphModel } from "../domains/graph-model.js";
import type { TDrawn } from "../page/graph/ports.js";

export const MESSAGE = "Email";
export const PERSON = "Person";
const GENERATED = LinkRelations.GENERATED_AT_TIME.rel;
/** A message's fields by their relations, as the store's catalog declares them. */
const MESSAGE_RELS: Record<string, string> = { subject: LinkRelations.NAME.rel, dateSent: LinkRelations.PUBLISHED.rel, dateReceived: LinkRelations.UPDATED.rel };
/** The field that holds a message's valid time. Every other type's valid time is the time its record was made. */
const MESSAGE_VALID_TIME = "dateReceived";

type TMessage = { id: string; subject: string; sent: string };
type TPerson = { id: string; name: string };

/** The mailbox's messages, people and edges. */
export const MAILBOX = {
	messages: [
		{ id: "a@test.com", subject: "Roadmap", sent: "2025-03-01T10:00:00.000Z" },
		{ id: "b@test.com", subject: "Re: Roadmap", sent: "2025-02-01T10:00:00.000Z" },
		{ id: "c@test.com", subject: "Hiking", sent: "2024-09-01T10:00:00.000Z" },
		{ id: "d@test.com", subject: "Limit", sent: "2024-06-01T10:00:00.000Z" },
		{ id: "e@test.com", subject: "Offsite", sent: "2024-03-01T10:00:00.000Z" },
	],
	people: [
		{ id: "alice@acme.com", name: "Alice" },
		{ id: "carol@acme.com", name: "Carol" },
	],
	edges: [
		{ from: "b@test.com", predicate: "inReplyTo", to: "a@test.com" },
		{ from: "c@test.com", predicate: "references", to: "a@test.com" },
		{ from: "d@test.com", predicate: "references", to: "e@test.com" },
	],
	/** Messages that arrive while the graph is drawn: a reply to the limit, and a reply to the offsite. */
	arriving: [
		{ id: "f@test.com", subject: "Re: Limit", sent: "2024-12-01T10:00:00.000Z" },
		{ id: "g@test.com", subject: "Re: Offsite", sent: "2025-01-15T10:00:00.000Z" },
	],
} as const satisfies { messages: TMessage[]; people: TPerson[]; edges: Array<{ from: string; predicate: string; to: string }>; arriving: TMessage[] };

const quad = (subject: string, namedGraph: string, predicate: string, object: string, objectType?: string): TQuad => ({
	subject,
	namedGraph,
	predicate,
	object,
	timestamp: 0,
	...(objectType === undefined ? {} : { objectType }),
});
const bodyOf = (message: string): string => `body:${message}`;

/** A message's quads as a store serves them: its fields, its record's time, and its body with the edge to it. */
export const messageQuads = ({ id, subject, sent }: TMessage, made: string): TQuad[] => [
	quad(id, MESSAGE, "subject", subject),
	quad(id, MESSAGE, "dateSent", sent),
	quad(id, MESSAGE, MESSAGE_VALID_TIME, sent),
	quad(id, MESSAGE, GENERATED, made),
	quad(id, MESSAGE, HAS_BODY_EDGE, bodyOf(id), BODY_LABEL),
	quad(bodyOf(id), BODY_LABEL, LinkRelations.CONTENT.rel, `Body of ${subject}`),
	quad(bodyOf(id), BODY_LABEL, GENERATED, made),
];

const personQuads = ({ id, name }: TPerson, made: string): TQuad[] => [quad(id, PERSON, "name", name), quad(id, PERSON, GENERATED, made)];

/** The mailbox's quads, each record made at `made`: its messages, its people where `withPeople`, and its edges. */
export function mailboxQuads(made: string, { withPeople }: { withPeople: boolean }): TQuad[] {
	return [
		...MAILBOX.messages.flatMap((m) => messageQuads(m, made)),
		...(withPeople ? MAILBOX.people.flatMap((p) => personQuads(p, made)) : []),
		...MAILBOX.edges.map(({ from, predicate, to }) => quad(from, MESSAGE, predicate, to, MESSAGE)),
	];
}

/** The clusters a store serves beside `quads`: each type's records, titled as the store titles them. */
export function clustersOf(quads: readonly TQuad[]): TCluster[] {
	const titles = new Map<string, Map<string, string>>();
	for (const q of quads) {
		const ofType = titles.get(q.namedGraph) ?? new Map<string, string>();
		titles.set(q.namedGraph, ofType);
		const title = q.predicate === "subject" || q.predicate === "name" || q.predicate === LinkRelations.CONTENT.rel ? String(q.object) : undefined;
		if (title !== undefined || !ofType.has(q.subject)) ofType.set(q.subject, title ?? q.subject);
	}
	return [...titles].map(([type, labels]) => ({
		type,
		totalCount: labels.size,
		sampledCount: labels.size,
		omittedCount: 0,
		sampledSubjects: [...labels.keys()],
		displayLabels: Object.fromEntries(labels),
	}));
}

/** The layout options a scene reads: the reader's choices, which the active view's own settled values override. */
export type TLayoutOptions = {
	viewType: ViewType;
	grouped: boolean;
	groupBy: GroupKeyMode;
	flatten: boolean;
	zBasis: "valid" | "indexed" | "connections";
	hiddenGraphs: string[];
	hiddenPredicates: string[];
	prune: boolean;
};

export const FORCE_LAYOUT: TLayoutOptions = {
	viewType: VIEW.force,
	grouped: false,
	groupBy: "type",
	flatten: false,
	zBasis: "valid",
	hiddenGraphs: [],
	hiddenPredicates: [],
	prune: false,
};

/** The scene's layout of a graph: the parts the scene composes, composed the same way. */
export class SceneLayout {
	options: TLayoutOptions;
	/** Where the reader dropped a node, which outranks every placement the layout makes. */
	readonly userPins = new Map<string, { x: number; y: number }>();
	#quads: TQuad[] = [];
	#clusters: TCluster[] = [];
	#model?: GraphModel;
	#seqNodes?: SeqNode[];
	#lastModelHash?: number;
	#links: FGLink[] = [];
	#ganttTargets = new Map<string, GanttTarget>();
	#ganttScale?: GanttScale;
	#anchors = new Map<string, GroupAnchor>();
	#sizes = new Map<string, { w: number; h: number }>();
	readonly #renderTypes = buildRenderTypeRegistry(
		{ ganttTarget: (id) => this.#ganttTargets.get(id), ganttPlacement: () => ({ scale: this.#ganttScale, count: this.#ganttTargets.size }) },
		{
			seqNodes: () => this.#sequenceNodes(),
			seqEdges: () => this.#visible().edges.map((e) => ({ from: e.from, to: e.to, predicate: e.predicate })),
			seqOptions: () => ({ labelOf: (id) => id, actorEdges: { from: new Set<string>(), to: new Set<string>() } }),
		},
	);
	readonly pipeline: DataPipeline;

	constructor(options: TLayoutOptions) {
		this.options = options;
		this.pipeline = new DataPipeline({
			viewType: () => this.options.viewType,
			flatten: () => this.#effective().flatten,
			grouped: () => this.#effective().grouped,
			groupBy: () => this.options.groupBy,
			quads: () => this.#quads,
			visibleQuads: () => this.#quads,
			hiddenGraphs: () => this.options.hiddenGraphs,
			visibleModel: () => this.#visible(),
			hollow: () => false,
			lastModelHash: () => this.#lastModelHash,
			timeCursor: () => null,
			zBasis: () => this.options.zBasis,
			relationOf: (predicate) => MESSAGE_RELS[predicate] ?? predicate,
			validTimeFieldFor: (type) => (type === MESSAGE ? MESSAGE_VALID_TIME : GENERATED),
			groupAnchors: () => this.#anchors,
			groupSizes: () => this.#sizes,
			setGanttTargets: (targets) => {
				this.#ganttTargets = targets;
			},
			setGanttScale: (scale) => {
				this.#ganttScale = scale;
			},
			setGanttAdornment: (_adornment: Adornment) => undefined,
			setGanttShapeSig: () => undefined,
			laneZ: (id) => this.renderType.lanePlacement(id)?.z,
			lanePinXY: (id) => {
				const lp = this.renderType.lanePlacement(id);
				if (!lp) return undefined;
				const x = lp.x ?? this.renderType.lanePlaneX;
				return x === undefined ? undefined : { x, y: lp.y };
			},
			userPinXY: (id) => this.userPins.get(id),
			startNewcomerPop: () => undefined,
		});
	}

	get renderType(): RenderType {
		const rt = this.#renderTypes.get(this.options.viewType);
		if (rt === undefined) throw new Error(`the render-type registry doesn't hold the view ${this.options.viewType}`);
		return rt;
	}

	get nodes(): Array<FGNode & XYZ> {
		return [...this.pipeline.nodeMap.values()].map((n) => {
			if (!isPlaced(n)) throw new Error(`the layout didn't place node ${n.id}`);
			return n;
		});
	}

	get links(): readonly FGLink[] {
		return this.#links;
	}

	/** The scene's data path: a feed's newcomers are placed while the nodes already placed hold still, damped after the first feed. */
	feed(quads: TQuad[]): TDrawn {
		this.#quads = quads;
		this.#clusters = clustersOf(quads);
		this.#invalidate();
		const firstFeed = this.#lastModelHash === undefined;
		const existing = new Set(this.pipeline.nodeMap.keys());
		const { nodes, links } = this.pipeline.toGraphData(false);
		this.#lastModelHash = this.pipeline.hashCurrentModel(nodes, links);
		this.#links = links;
		this.#recomputeGroupAnchors(nodes);
		const held = nodes.filter((n) => existing.has(n.id) && n.x !== undefined && n.y !== undefined && n.fx === undefined);
		for (const n of held) {
			n.fx = n.x;
			n.fy = n.y;
		}
		this.#place(nodes, links, !firstFeed);
		// The engine's stop releases the pins the feed held, as the scene's own stop does.
		for (const n of held) {
			n.fx = undefined;
			n.fy = undefined;
		}
		return { nodes, links };
	}

	/** The scene's layout path: a change of the options places every node again, and each rests at its target. */
	relayout(change: Partial<TLayoutOptions>): TDrawn {
		this.options = { ...this.options, ...change };
		this.pipeline.parkedPositions.clear();
		this.pipeline.linkMap.clear();
		this.#invalidate();
		for (const n of this.pipeline.nodeMap.values()) {
			n.fx = undefined;
			n.fy = undefined;
			n.fz = undefined;
		}
		this.#recomputeGroupAnchors([...this.pipeline.nodeMap.values()]);
		const { nodes, links } = this.pipeline.toGraphData(true);
		this.#lastModelHash = this.pipeline.hashCurrentModel(nodes, links);
		this.#links = links;
		this.#place(nodes, links, false);
		for (const n of nodes) {
			const kept = this.userPins.has(n.id);
			n.fx = kept ? n.x : undefined;
			n.fy = kept ? n.y : undefined;
		}
		return { nodes, links };
	}

	/** The box the enclosures draw around each group, by the group's key, while the view groups its nodes. */
	boxes(): Map<string, GroupBox> {
		if (!this.#effective().grouped) return new Map();
		const byKey = new Map<string, Array<FGNode & XYZ>>();
		for (const n of this.nodes) {
			const key = groupKeyOf(n, this.options.groupBy);
			byKey.set(key, [...(byKey.get(key) ?? []), n]);
		}
		return new Map(
			[...byKey].flatMap(([key, members]) => {
				const box = groupBounds(members, ENCLOSURE_PAD, (n) => ({ rx: collideRadius(n), ry: chipTextHeight(n) }));
				return box === null ? [] : [[key, box] as const];
			}),
		);
	}

	/** The ids of the drawn nodes that a drawn edge doesn't touch. */
	isolated(): string[] {
		const linked = new Set(this.#links.flatMap((l) => [linkEndId(l.source), linkEndId(l.target)]));
		return this.nodes.filter((n) => !linked.has(n.id)).map((n) => n.id);
	}

	#effective(): TLayoutOptions {
		return { ...this.options, ...this.renderType.forces };
	}

	#place(nodes: FGNode[], links: FGLink[], damped: boolean): void {
		const grouped = this.#effective().grouped;
		forceLayout({
			grouped,
			suppressesGrouping: this.renderType.suppressesGrouping,
			groupBy: this.options.groupBy,
			anchors: this.#anchors,
			nodeMap: this.pipeline.nodeMap,
			lanePlacement: (id) => this.renderType.lanePlacement(id),
		}).place(nodes, links, { damped });
	}

	#recomputeGroupAnchors(nodes: FGNode[]): void {
		const byGroup = new Map<string, FGNode[]>();
		for (const n of nodes) {
			const key = groupKeyOf(n, this.options.groupBy);
			byGroup.set(key, [...(byGroup.get(key) ?? []), n]);
		}
		this.#sizes = new Map([...byGroup].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => [key, groupCellSize(members)]));
		this.#anchors = shelfPack(this.#sizes, GROUP_GAP);
	}

	#visible(): GraphModel {
		this.#model ??= visibleGraphModel({
			quads: this.#quads,
			clusters: this.#clusters,
			hiddenGraphs: this.options.hiddenGraphs,
			hiddenPredicates: this.options.hiddenPredicates,
			prune: this.options.prune,
			roleRels: [],
		});
		return this.#model;
	}

	#sequenceNodes(): SeqNode[] {
		this.#seqNodes ??= seqNodesOf(this.#visible().nodes, this.pipeline.extractTimes().times);
		return this.#seqNodes;
	}

	#invalidate(): void {
		this.#model = undefined;
		this.#seqNodes = undefined;
	}
}
