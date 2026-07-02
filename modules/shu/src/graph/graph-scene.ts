/**
 * Backend-neutral graph-scene vocabulary — the hand-off between per-@type presenters (which decide a node's SEMANTICS:
 * what mark, what colour/label, where it sits) and the paints (3D, SVG) that draw it in their own medium. One
 * vocabulary so the two renders cannot drift, so a new type is a new presenter (one method) and a new backend is a new
 * paint (one translator). Pure + fail-fast validated: a malformed mark/role throws at this boundary rather than letting
 * a paint render garbage. No THREE, no DOM — unit-tested headlessly.
 */

/** The visual marks a node can be drawn as. EVERY paint must handle each kind it's given, or throw — never skip silently. */
export const MARK_KINDS = ["chip", "square", "lozenge", "box", "image", "mesh", "marker"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** Where a node sits, declared by its type's presenter. A backend-neutral layout pass resolves roles to coordinates
 *  (shared scales across all nodes of a role) so both paints place marks identically. `free` leaves x/y to the force
 *  layout (z is the recorded-time depth); `xyz` pins explicit 3D coordinates. */
export type LayoutRole =
	| { kind: "free" }
	| { kind: "time"; start: number; end: number } // calendar: an epoch-ms span → a z time-axis + a lane
	| { kind: "geo"; lat: number; lon: number } // map: lat/long → x/y
	| { kind: "xyz"; x: number; y: number; z: number }; // explicit 3D coordinates

/** A node's presentation, medium-agnostic: the mark + its colour/label + its layout role. `zExtent` is the mark's
 *  length along the layout axis (a calendar bar's duration, in world units) — required for, and only used by, "box".
 *  `image` is the source URL — required for, and only used by, "image". */
export type NodeMark = {
	id: string;
	type: string;
	kind: MarkKind;
	label: string;
	color: string;
	role: LayoutRole;
	isCluster?: boolean;
	zExtent?: number;
	image?: string;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Fail-fast validation of a layout role — a bad role is a programming error in a presenter, surfaced here. */
export function assertLayoutRole(r: LayoutRole, id: string): LayoutRole {
	switch (r.kind) {
		case "free":
			break;
		case "time":
			if (!finite(r.start) || !finite(r.end) || r.end < r.start) throw new Error(`LayoutRole ${id}: time needs finite start <= end`);
			break;
		case "geo":
			if (!finite(r.lat) || !finite(r.lon)) throw new Error(`LayoutRole ${id}: geo needs finite lat/lon`);
			break;
		case "xyz":
			if (!finite(r.x) || !finite(r.y) || !finite(r.z)) throw new Error(`LayoutRole ${id}: xyz needs finite x/y/z`);
			break;
		default:
			throw new Error(`LayoutRole ${id}: unknown kind "${(r as { kind: string }).kind}"`);
	}
	return r;
}

/** Fail-fast validation of a presenter's mark — returns it so a presenter can `return assertNodeMark({...})`. */
export function assertNodeMark(m: NodeMark): NodeMark {
	if (!MARK_KINDS.includes(m.kind)) throw new Error(`NodeMark ${m.id}: unknown kind "${m.kind}"`);
	if (!m.color) throw new Error(`NodeMark ${m.id}: missing color`);
	if (m.kind === "box" && !(finite(m.zExtent) && (m.zExtent as number) >= 0)) throw new Error(`NodeMark ${m.id}: box requires a finite zExtent >= 0`);
	if (m.kind === "image" && !m.image) throw new Error(`NodeMark ${m.id}: image requires a src`);
	assertLayoutRole(m.role, m.id);
	return m;
}
