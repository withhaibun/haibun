/**
 * Where the graph scene places a small mailbox in each view, through the scene's own layout parts and without a browser:
 * the force view spreads it on the plane and in depth, a stream lands beside what is placed without moving it, group boxes
 * are exclusive and packed in every layout, the lane views put every node on their plane, the layered views read as a ranked
 * flow, and each return to the force view spreads the graph again.
 */
import { describe, expect, it } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/domains/resources.js";
import { FORCE_LAYOUT, MAILBOX, MESSAGE, PERSON, SceneLayout, mailboxQuads, messageQuads, type TLayoutOptions } from "../../../test/scene-layout.js";
import { PolymorphicCamera, type CameraDeps } from "../machines/camera.js";
import { framesGraph, screenShare, type TProjected } from "../derivations/project.js";
import { FRAME, REFRAME, VIEW } from "../domains/views.js";
import type { GroupBox } from "../derivations/grouping.js";
import type { XYZ } from "../domains/graph-types.js";

/** The least range, on x and on y, of a layout that spreads its nodes on both axes. */
const SPREAD = 10;
/** The least range of depth across which time spreads the nodes. */
const TIME_DEPTH = 1;
/** The most a grouping's boxes scatter: the area of their bounding box over their summed area. */
const PACKED = 8;
/** How far a placed node may move while a stream lands, on any axis together. */
const HELD = 2;
const MADE = new Date().toISOString();

const range = (values: number[]): number => (values.length ? Math.max(...values) - Math.min(...values) : 0);
/** The lesser of the ranges the nodes span on x and on y. */
const extentOf = (layout: SceneLayout): number => Math.min(range(layout.nodes.map((n) => n.x)), range(layout.nodes.map((n) => n.y)));
/** The range of depth across the nodes with a time. */
const timeDepthOf = (layout: SceneLayout): number => range(layout.nodes.filter((n) => n.__t !== undefined).map((n) => n.z));
const laidOut = (options: Partial<TLayoutOptions>, { withPeople }: { withPeople: boolean }): SceneLayout => {
	const layout = new SceneLayout({ ...FORCE_LAYOUT, ...options });
	layout.feed(mailboxQuads(MADE, { withPeople }));
	return layout;
};

const overlap1D = (c1: number, s1: number, c2: number, s2: number): number => Math.max(0, Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2));
/** The pairs of group boxes that overlap on the plane, each named by its two keys. */
const overlapping = (boxes: Map<string, GroupBox>): string[] => {
	const all = [...boxes];
	return all.flatMap(([a, p], i) =>
		all.slice(i + 1).flatMap(([b, q]) => (overlap1D(p.cx, p.sx, q.cx, q.sx) > 0 && overlap1D(p.cy, p.sy, q.cy, q.sy) > 0 ? [`${a} and ${b}`] : [])),
	);
};
/** The area of the boxes' bounding box over their summed area: 1 where they tile it, larger as they scatter. */
const packingOf = (boxes: Map<string, GroupBox>): number => {
	const all = [...boxes.values()];
	const width = Math.max(...all.map((b) => b.cx + b.sx / 2)) - Math.min(...all.map((b) => b.cx - b.sx / 2));
	const height = Math.max(...all.map((b) => b.cy + b.sy / 2)) - Math.min(...all.map((b) => b.cy - b.sy / 2));
	return (width * height) / all.reduce((sum, b) => sum + b.sx * b.sy, 0);
};

/** A camera that frames the nodes from the front, as the scene's first settle does, and projects a point as it draws it. */
function frontCamera(nodes: () => XYZ[]) {
	const vec = (x: number, y: number, z: number) => ({
		x,
		y,
		z,
		set(nx: number, ny: number, nz: number) {
			this.x = nx;
			this.y = ny;
			this.z = nz;
		},
	});
	const target = vec(0, 0, 0);
	const position = vec(0, 0, 300);
	const camera = { fov: 80, aspect: 1, position, up: vec(0, 1, 0), updateProjectionMatrix: () => undefined };
	const deps = {
		camera: () => camera,
		controls: () => ({ target, object: { position }, update: () => undefined }),
		container: () => undefined,
		renderer: () => undefined,
		canvas: () => undefined,
		nodePositions: nodes,
		hasNodes: () => nodes().length > 0,
		reframeMode: () => REFRAME.front,
		ganttExtent: () => null,
		sequenceExtent: () => null,
		refreshPickBounds: () => undefined,
	} as unknown as CameraDeps;
	const tanV = Math.tan((camera.fov * Math.PI) / 360);
	const project = (p: XYZ): TProjected => {
		const depth = position.z - p.z;
		return { x: (p.x - position.x) / (depth * tanV * camera.aspect), y: (p.y - position.y) / (depth * tanV), z: depth > 0 ? 0 : 2 };
	};
	return { camera: new PolymorphicCamera(deps), project };
}

describe("the force view of the mailbox", () => {
	it("spreads the nodes on x and on y, and places their dates across a range of depth", () => {
		const layout = laidOut({}, { withPeople: false });
		expect(extentOf(layout), "the lesser of the ranges on x and y").toBeGreaterThan(SPREAD);
		expect(timeDepthOf(layout), "the range of depth the dates span").toBeGreaterThan(TIME_DEPTH);
	});

	it("brings the most connected node in front of the least connected one under the connections basis, and spreads depth by time again under valid time", () => {
		const layout = laidOut({}, { withPeople: false });
		layout.relayout({ zBasis: "connections" });
		const byDegree = layout.nodes.filter((n) => n.__degree !== undefined).sort((a, b) => (a.__degree as number) - (b.__degree as number));
		const [least, most] = [itemAt(byDegree, 0), itemAt(byDegree, byDegree.length - 1)];
		expect(most.__degree, "the graph holds nodes of more than one degree").toBeGreaterThan(least.__degree as number);
		expect(most.z, `${most.id} (${most.__degree} links) is in front of ${least.id} (${least.__degree})`).toBeLessThan(least.z);
		layout.relayout({ zBasis: "valid" });
		expect(timeDepthOf(layout)).toBeGreaterThan(TIME_DEPTH);
	});

	it("lands an arriving message in the layout while the placed nodes hold still in depth as on the plane, so a camera that framed the graph still frames it", () => {
		const layout = laidOut({}, { withPeople: false });
		const { camera, project } = frontCamera(() => layout.nodes);
		camera.frame(FRAME.front);
		const before = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]));
		const [arriving] = MAILBOX.arriving;
		layout.feed([...mailboxQuads(MADE, { withPeople: false }), ...messageQuads(arriving, MADE)]);
		const landed = layout.nodes.find((n) => n.id === arriving.id);
		expect(landed, "the arriving message is drawn").toBeDefined();
		expect(Math.hypot(landed?.x ?? 0, landed?.y ?? 0), "placed in the layout, not left at the origin").toBeGreaterThan(1);
		for (const n of layout.nodes) {
			const was = before.get(n.id);
			if (was) expect(Math.hypot(n.x - was.x, n.y - was.y, n.z - was.z), `${n.id} held its place`).toBeLessThanOrEqual(HELD);
		}
		expect(framesGraph(screenShare(layout.nodes.map(project))), "the camera that framed the graph frames it after the arrival").toBe(true);
	});

	it("leaves the graph spread after the schema's terms are shown and put away again", () => {
		const layout = laidOut({}, { withPeople: false });
		const schema = [
			{ subject: MESSAGE, namedGraph: CLASS_LABEL, predicate: "name", object: MESSAGE, timestamp: 0 },
			{ subject: "generatedAtTime", namedGraph: PROPERTY_LABEL, predicate: "name", object: "generatedAtTime", timestamp: 0 },
			...MAILBOX.messages.map((m) => ({ subject: MESSAGE, namedGraph: CLASS_LABEL, predicate: "instance", object: m.id, objectType: MESSAGE, timestamp: 0 })),
		];
		layout.feed([...mailboxQuads(MADE, { withPeople: false }), ...schema]);
		expect(
			layout.nodes.some((n) => n.type === CLASS_LABEL),
			"the schema's class is drawn",
		).toBe(true);
		layout.feed(mailboxQuads(MADE, { withPeople: false }));
		expect(extentOf(layout)).toBeGreaterThan(SPREAD);
	});
});

describe("grouping the mailbox", () => {
	for (const viewType of [VIEW.force, VIEW.td, VIEW.lr]) {
		it(`draws an exclusive, packed box around each kind of node in the ${viewType} view`, () => {
			const layout = laidOut({}, { withPeople: true });
			layout.relayout({ grouped: true, viewType });
			const boxes = layout.boxes();
			expect([...boxes.keys()].length, "a box for each kind").toBeGreaterThan(1);
			expect(overlapping(boxes), "the pairs of boxes that overlap").toEqual([]);
			expect(packingOf(boxes), "how far the boxes scatter").toBeLessThan(PACKED);
		});
	}

	it("lays a graph grouped before its first feed out on the plane, with its boxes, rather than at a point", () => {
		const layout = laidOut({ grouped: true }, { withPeople: true });
		expect(extentOf(layout)).toBeGreaterThan(SPREAD);
		expect(layout.boxes().size).toBeGreaterThan(0);
	});
});

describe("the lane views of the mailbox", () => {
	it("draws every node of the sequence on its plane, where the sequence placed it, and spreads the graph again on the force view", () => {
		const layout = laidOut({}, { withPeople: true });
		layout.relayout({ viewType: VIEW.sequence });
		const placement = layout.renderType.seqLayout?.().placement;
		expect(placement, "the sequence places its nodes").toBeDefined();
		const offPlane = layout.nodes.filter((n) => {
			const p = placement?.get(n.id);
			return Math.abs(n.x) > 1 || (p !== undefined && (Math.abs(n.y - p.y) > 1 || Math.abs(n.z - p.z) > 1));
		});
		expect(offPlane.map((n) => n.id)).toEqual([]);
		layout.relayout({ viewType: VIEW.force });
		expect(extentOf(layout)).toBeGreaterThan(SPREAD);
	});

	it("places each message on the gantt calendar, and spreads the graph again on the force view", () => {
		const layout = laidOut({}, { withPeople: true });
		layout.relayout({ viewType: VIEW.gantt });
		expect(layout.renderType.axisLegend()?.count, "a task for each sent message").toBe(MAILBOX.messages.length);
		layout.relayout({ viewType: VIEW.force });
		expect(extentOf(layout)).toBeGreaterThan(SPREAD);
	});
});

describe("the layered views of the mailbox", () => {
	for (const viewType of [VIEW.td, VIEW.lr]) {
		it(`reads the ${viewType} view as a ranked flow: each rank past the one before along the flow, spanning more than the depth time adds`, () => {
			const layout = laidOut({}, { withPeople: false });
			layout.relayout({ viewType });
			const flow = layout.renderType.layeredFlow();
			expect(flow, "a layered view states its flow").not.toBeNull();
			const along = (p: { x: number; y: number }): number => (flow?.flowAxis === "y" ? p.y : p.x);
			const ranks = new Map<number, number[]>();
			for (const n of layout.nodes) {
				const target = layout.renderType.lanePlacement(n.id);
				if (target === undefined) continue;
				const rank = Math.round(along({ x: target.x ?? 0, y: target.y }));
				ranks.set(rank, [...(ranks.get(rank) ?? []), along(n)]);
			}
			const bands = [...ranks].sort(([a], [b]) => a - b).map(([, at]) => ({ mean: at.reduce((sum, v) => sum + v, 0) / at.length, least: Math.min(...at), most: Math.max(...at) }));
			expect(bands.length, "two or more ranks").toBeGreaterThanOrEqual(2);
			for (const [j, band] of bands.entries()) {
				if (j === 0) continue;
				const before = itemAt(bands, j - 1);
				expect(band.mean, `rank ${j} advances past rank ${j - 1}`).toBeGreaterThan(before.mean);
				expect(band.least, `rank ${j} starts past where rank ${j - 1} ends`).toBeGreaterThan(before.most);
			}
			expect(range(layout.nodes.map(along)), "the flow spans more than the depth time adds").toBeGreaterThanOrEqual(range(layout.nodes.map((n) => n.z)));
		});
	}
});

describe("what the mailbox's filters leave drawn", () => {
	it("drops the reference edges while a reader hides that property, keeping the replies, and draws them again when shown", () => {
		const layout = laidOut({}, { withPeople: false });
		const predicates = (): string[] => [...new Set(layout.links.map((l) => l.predicate))];
		expect(predicates()).toContain("references");
		layout.relayout({ hiddenPredicates: ["references"] });
		expect(predicates()).not.toContain("references");
		expect(predicates()).toContain("inReplyTo");
		layout.relayout({ hiddenPredicates: [] });
		expect(predicates()).toContain("references");
	});

	it("draws the people an edge doesn't touch until the prune is on, and draws them again when it is off", () => {
		const layout = laidOut({}, { withPeople: true });
		expect(layout.isolated(), "the people stand alone").toEqual(expect.arrayContaining(MAILBOX.people.map((p) => p.id)));
		layout.feed(mailboxQuads(MADE, { withPeople: true }));
		layout.options = { ...layout.options, prune: true };
		layout.feed(mailboxQuads(MADE, { withPeople: true }));
		expect(layout.isolated()).toEqual([]);
		expect(layout.nodes.some((n) => n.type === PERSON)).toBe(false);
		layout.options = { ...layout.options, prune: false };
		layout.feed(mailboxQuads(MADE, { withPeople: true }));
		expect(layout.isolated().length).toBeGreaterThan(0);
	});
});

describe("a slice of the mailbox the time cursor leaves", () => {
	it("draws fewer nodes while the cursor hides the later records, and every node again, placed, once the cursor is cleared", () => {
		const layout = laidOut({}, { withPeople: false });
		const whole = mailboxQuads(MADE, { withPeople: false });
		const drawn = layout.nodes.length;
		const [kept] = MAILBOX.messages;
		layout.feed(whole.filter((q) => q.subject === kept.id || q.subject === `body:${kept.id}`));
		expect(layout.nodes.length, "the cursor's slice").toBeLessThan(drawn);
		layout.feed(whole);
		expect(layout.nodes.length, "every record again").toBe(drawn);
		expect(extentOf(layout)).toBeGreaterThan(SPREAD);
	});
});

describe("a node the reader dropped", () => {
	it("keeps the place it was dropped at through a repaint that brings an arriving message", () => {
		const layout = laidOut({}, { withPeople: false });
		const dropped = { id: itemAt(MAILBOX.messages, 2).id, x: 140, y: -60 };
		layout.userPins.set(dropped.id, { x: dropped.x, y: dropped.y });
		layout.feed([...mailboxQuads(MADE, { withPeople: false }), ...messageQuads(itemAt(MAILBOX.arriving, 1), MADE)]);
		const node = layout.nodes.find((n) => n.id === dropped.id);
		expect(node?.fx, "still pinned").toBe(dropped.x);
		expect([node?.x, node?.y]).toEqual([dropped.x, dropped.y]);
	});

	it("comes back pinned where it was dropped in a layout that starts from the pins a reload restores", () => {
		const dropped = { id: itemAt(MAILBOX.messages, 0).id, x: -90, y: 75 };
		const layout = new SceneLayout(FORCE_LAYOUT);
		layout.userPins.set(dropped.id, { x: dropped.x, y: dropped.y });
		layout.feed(mailboxQuads(MADE, { withPeople: false }));
		const node = layout.nodes.find((n) => n.id === dropped.id);
		expect([node?.fx, node?.x, node?.y]).toEqual([dropped.x, dropped.x, dropped.y]);
	});
});
