// The fisheye's group-enclosure subsystem: the translucent type-coloured box + wire border + area title drawn around each
// group's members (the 3D read of the SVG group box), plus the per-group ring anchors + footprint radii that drive the
// cohesion force. The boxes only ever TRACK the settled members — they never trigger a relayout, so the layout the user
// got is the layout that stays; geometry is drawn once after a data settle, not every frame.
//
// Wired like FisheyeCamera/FisheyeFocus: constructor-injected accessor deps read at CALL time, so a per-repaint-refreshed
// nodeMap, a theme-recoloured label colour, or the late-bound forcegraph parent is always current; the component keeps
// the leaf state it shares with the gantt/swimlane overlays (the shared unit geometries are owned here and read back via
// accessors) and delegates the enclosure concern entirely. (lovely-finding-babbage, step 2.)

import { roleNounFor } from "../../rels-cache.js";
import SpriteText from "three-spritetext";
import { colorForType } from "../../type-colors.js";
import { groupKeyOf, containerLabelOf, shelfPack, groupBounds, type GroupAnchor, type GroupKeyMode, ENCLOSURE_PAD, GROUP_GAP } from "../grouping.js";
import { HYPERMEDIA_ROLE_REL_KEY } from "../../graph-model.js";
import { type FGNode, type TSprite } from "../polymorphic/polymorphic-graph-types.js";
import { chipTextHeight, collideRadius } from "../polymorphic/layout-forces.js";
import { groupCellSize } from "../polymorphic/group-grid.js";
import { FOCUS_RENDER_ORDER } from "../polymorphic/polymorphic-focus.js";

// Group enclosures: each group's members cohere toward a ring anchor (pure math in @haibun/shu/graph/grouping.ts), then a
// translucent type-coloured box with a wire border is drawn around them — the 3D read of the SVG group box.
export const ENCLOSURE_FILL_OPACITY = 0.07;
export const ENCLOSURE_EDGE_OPACITY = 0.55;
export const ENCLOSURE_RENDER_ORDER = -1; // behind nodes/edges; depthWrite is off so it never occludes them
// Group titles render above everything except the focus pop — an area heading shouldn't be occluded by chips
// or edges, but the one thing the user is actively reading stays on top of it.
export const ENCLOSURE_LABEL_RENDER_ORDER = FOCUS_RENDER_ORDER - 0.5;
export const ENCLOSURE_LABEL_HEIGHT = 5;

type Disposable = { dispose(): void };
type Vec3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
type Obj3D = {
	position: Vec3;
	scale: Vec3;
	renderOrder: number;
	visible: boolean;
	parent: Obj3D | null;
	children: Obj3D[];
	raycast: () => void;
	add(o: Obj3D): void;
	remove(o: Obj3D): void;
};
type EnclMaterial = Disposable & { color: { set(c: string): void }; opacity: number };
export interface EnclosureThree {
	Group: new () => Obj3D;
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	LineSegments: new (geometry: unknown, material: unknown) => Obj3D;
	BoxGeometry: new (w: number, h: number, d: number) => Disposable;
	EdgesGeometry: new (geometry: unknown) => Disposable;
	MeshBasicMaterial: new (params: Record<string, unknown>) => EnclMaterial;
	LineBasicMaterial: new (params: Record<string, unknown>) => EnclMaterial;
	DoubleSide: number;
}

export type Enclosure = { box: Obj3D; boxMat: EnclMaterial; edges: Obj3D; edgeMat: EnclMaterial; label: TSprite };

/** Live refs + queries the component exposes; every getter is read at CALL time so a per-repaint nodeMap or a
 *  theme-recoloured colour is always current — never copied. */
export type EnclosureDeps = {
	three: () => EnclosureThree | undefined; // the scene's OWN bundled THREE (AFRAME.THREE) — null until the scene loads
	nodeMap: () => Map<string, FGNode>;
	groupBy: () => GroupKeyMode;
	grouped: () => boolean;
	edgeLabelColor: () => string;
	enclosureParent: () => Obj3D | undefined; // the forcegraph object3D the box group parents into (shared node coordinate space)
	applyEnclosureFocus: () => void; // re-assert the active dim state on boxes created this pass
};

export class EnclosureController {
	private groupAnchorsMap = new Map<string, GroupAnchor>();
	private groupSizesMap = new Map<string, { w: number; h: number }>(); // per-group footprint RECTANGLE, from recomputeGroupAnchors
	private enclosuresMap = new Map<string, Enclosure>();
	private enclosureGroup?: Obj3D;
	private unitBoxGeo?: Disposable; // shared unit BoxGeometry; each enclosure scales it, so geometry is never rebuilt per frame
	private unitEdgesGeo?: Disposable; // shared unit-box EdgesGeometry (the wire border)

	constructor(private deps: EnclosureDeps) {}

	/** Live views for inspect()/the cohesion force/the focus subsystem — the controller owns the maps, callers only read. */
	get anchors(): Map<string, GroupAnchor> {
		return this.groupAnchorsMap;
	}
	get sizes(): Map<string, { w: number; h: number }> {
		return this.groupSizesMap;
	}
	get enclosures(): Map<string, Enclosure> {
		return this.enclosuresMap;
	}
	/** The shared unit geometries, reused by the component's gantt drag ghost (kept here so there's one owner). */
	get unitBox(): Disposable | undefined {
		return this.unitBoxGeo;
	}
	get unitEdges(): Disposable | undefined {
		return this.unitEdgesGeo;
	}

	/** Each group's enclosure is placed by a RECTANGLE shelf-pack over its real {w,h} footprint, so the boxes can't
	 * overlap AND one wide chip can't shove the others away (the old √Σradius² disc squared a wide member into a giant
	 * square in both axes). The footprint is a √count grid of the members' ACTUAL collide size — bounded by
	 * MAX_LABEL_CHARS, so one long id can't inflate it — so the FIRST packing is the final one: no correction round. */
	recomputeGroupAnchors(nodes: FGNode[]): void {
		const groupBy = this.deps.groupBy();
		const byGroup = new Map<string, FGNode[]>();
		for (const n of nodes) {
			const k = groupKeyOf(n, groupBy);
			const arr = byGroup.get(k);
			if (arr) arr.push(n);
			else byGroup.set(k, [n]);
		}
		const sizes = new Map<string, { w: number; h: number }>();
		for (const [k, members] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) sizes.set(k, groupCellSize(members));
		this.groupSizesMap = sizes; // members pin to a deterministic grid (gridSlot) inside this footprint (see toGraphData)
		this.groupAnchorsMap = shelfPack(sizes, GROUP_GAP);
	}

	/** The shared unit box + its wire edges (1×1×1), scaled per use. Built once, reused by the enclosures and the gantt
	 *  drag ghost; disposed on teardown. */
	ensureUnitBox(T: EnclosureThree): void {
		if (!this.unitBoxGeo) this.unitBoxGeo = new T.BoxGeometry(1, 1, 1);
		if (!this.unitEdgesGeo) this.unitEdgesGeo = new T.EdgesGeometry(this.unitBoxGeo);
	}

	/** Lazily build the shared geometries + the group that holds every enclosure, parented to the forcegraph object (re-attached if a relayout rebuilt it). Returns false until the scene is ready. */
	private ensureEnclosureRoot(): boolean {
		const T = this.deps.three();
		if (!T) return false;
		this.ensureUnitBox(T);
		if (!this.enclosureGroup) {
			this.enclosureGroup = new T.Group();
			(this.enclosureGroup as Obj3D & { name: string }).name = "shu-group-enclosures";
		}
		if (!this.enclosureGroup.parent) {
			const parent = this.deps.enclosureParent();
			if (!parent) return false;
			parent.add(this.enclosureGroup);
		}
		return true;
	}

	private createEnclosure(T: EnclosureThree, key: string, labelText: string): Enclosure {
		const color = colorForType(key);
		const boxMat = new T.MeshBasicMaterial({ color, transparent: true, opacity: ENCLOSURE_FILL_OPACITY, depthWrite: false, side: T.DoubleSide });
		const box = new T.Mesh(this.unitBoxGeo, boxMat);
		const edgeMat = new T.LineBasicMaterial({ color, transparent: true, opacity: ENCLOSURE_EDGE_OPACITY, depthWrite: false });
		const edges = new T.LineSegments(this.unitEdgesGeo, edgeMat);
		// The group title is distinct from node chips by typography alone: larger BOLD text in the theme's label
		// colour, no fill or border — an area heading, quiet enough not to compete with the nodes.
		const label = new SpriteText(labelText, ENCLOSURE_LABEL_HEIGHT, this.deps.edgeLabelColor()) as unknown as TSprite & { fontWeight: string };
		label.fontWeight = "bold";
		// Box + border sit behind the graph; the title reads above the box but under node chips, and never depth-hides.
		for (const o of [box, edges]) {
			o.raycast = () => undefined;
			o.renderOrder = ENCLOSURE_RENDER_ORDER;
		}
		label.renderOrder = ENCLOSURE_LABEL_RENDER_ORDER;
		label.material.depthTest = false;
		label.material.depthWrite = false;
		if (label.raycast) label.raycast = () => undefined;
		return { box, boxMat, edges, edgeMat, label };
	}

	private disposeEnclosure(e: Enclosure): void {
		for (const o of [e.box, e.edges, e.label as unknown as Obj3D]) this.enclosureGroup?.remove(o);
		e.boxMat.dispose();
		e.edgeMat.dispose();
		(e.label as unknown as Partial<Disposable>).dispose?.();
	}

	clearEnclosures(): void {
		for (const e of this.enclosuresMap.values()) this.disposeEnclosure(e);
		this.enclosuresMap.clear();
	}

	/** Box geometry per group (sampled, not every frame): bounds, mesh placement, title at the box's world
	 * upper-left, lifecycle. The boxes only ever TRACK the members — they never trigger relayouts, so the layout
	 * the user got is the layout that stays. */
	updateEnclosureGeometry(): void {
		if (!this.deps.grouped()) {
			if (this.enclosuresMap.size) this.clearEnclosures();
			return;
		}
		const T = this.deps.three();
		if (!T || !this.ensureEnclosureRoot() || !this.enclosureGroup) return;
		const groupBy = this.deps.groupBy();
		const byKey = new Map<string, FGNode[]>();
		const labelById = new Map<string, string>(); // id → display label, so a role container reads the party's name not its DID
		const typeById = new Map<string, string>(); // id → vertex type, the fallback designation when a party has no role rel
		const roleRelById = new Map<string, unknown>(); // id → the role rel a party plays, so its container reads that role not its type
		for (const n of this.deps.nodeMap().values()) {
			const arr = byKey.get(groupKeyOf(n, groupBy));
			if (arr) arr.push(n);
			else byKey.set(groupKeyOf(n, groupBy), [n]);
			if (n.name) labelById.set(n.id, n.name);
			if (n.type) typeById.set(n.id, n.type);
			if (n.properties?.[HYPERMEDIA_ROLE_REL_KEY] !== undefined) roleRelById.set(n.id, n.properties[HYPERMEDIA_ROLE_REL_KEY]);
		}
		// Under the role axis a container reads "<role> — <party>" (e.g. "Issuer — Coastal Fisheries Authority"). The role
		// is the party's role designation — named from the role rel by which nodes attribute to it, not the party's vertex
		// type (one Principal per DID). Under the type axis the plain type key (containerLabelOf) stands.
		const containerLabel = (k: string): string => {
			if (groupBy !== "role") return containerLabelOf(k, groupBy, labelById);
			const party = labelById.get(k) ?? k;
			const role = roleNounFor(roleRelById.get(k)) ?? typeById.get(k);
			return role && role !== party ? `${role} — ${party}` : party;
		};
		for (const [key, members] of byKey) {
			// Chips are centred on the node (sprite.center = (0.5, 0.5)), so the footprint is symmetric (± rx about node.x)
			// — groupBounds' own ± rx computation covers it directly, no per-member x shift needed.
			const b = groupBounds(members, ENCLOSURE_PAD, (m) => {
				const n = m as FGNode;
				return { rx: collideRadius(n), ry: chipTextHeight(n) };
			});
			if (!b) continue;
			let e = this.enclosuresMap.get(key);
			if (!e) {
				e = this.createEnclosure(T, key, containerLabel(key));
				this.enclosuresMap.set(key, e);
				for (const o of [e.box, e.edges, e.label as unknown as Obj3D]) this.enclosureGroup.add(o);
			}
			e.box.position.set(b.cx, b.cy, b.cz);
			e.box.scale.set(b.sx, b.sy, b.sz);
			e.edges.position.set(b.cx, b.cy, b.cz);
			e.edges.scale.set(b.sx, b.sy, b.sz);
			// The title sits at the box's WORLD upper-left corner — a fixed point ON the box, so orbiting moves it
			// exactly with its group (the sprite billboards, so the text always reads). Centre-anchored sprite:
			// inset by half its width so its LEFT edge starts at the corner; a title wider than its box clamps.
			const inset = Math.min(e.label.scale.x / 2, b.sx / 2);
			e.label.position.set(b.cx - b.sx / 2 + inset, b.cy + b.sy / 2 + ENCLOSURE_LABEL_HEIGHT / 2, b.cz);
		}
		for (const [key, e] of this.enclosuresMap) {
			if (byKey.has(key)) continue;
			this.disposeEnclosure(e);
			this.enclosuresMap.delete(key);
		}
		this.deps.applyEnclosureFocus(); // enclosures created this pass adopt the active dim state
	}

	/** Recolour the area titles in place under a theme change — a graphData re-feed would reheat the layout. */
	recolorLabels(color: string): void {
		for (const e of this.enclosuresMap.values()) e.label.color = color;
	}

	/** Teardown: drop the boxes + the shared geometries (the component's overlays already disposed their own copies). */
	dispose(): void {
		this.clearEnclosures();
		this.unitBoxGeo?.dispose();
		this.unitEdgesGeo?.dispose();
	}
}
