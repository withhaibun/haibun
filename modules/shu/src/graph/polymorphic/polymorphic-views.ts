// The polymorphic's central CATALOG of view-type + camera identifiers: the SINGLE source for these strings. Nothing else
// declares them as bare literals: the render types, the camera, the data pipeline, the view, and the controls all
// reference VIEW.* / REFRAME.*. A rename or a new view is one edit here.

/** The view types the polymorphic view can render. force/td/lr are force-layout variants; gantt + sequence are time-on-z views. */
export const VIEW = {
	force: "force",
	td: "td",
	lr: "lr",
	gantt: "gantt",
	sequence: "sequence",
} as const;
export const VIEW_TYPES = [VIEW.force, VIEW.td, VIEW.lr, VIEW.gantt, VIEW.sequence] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/** Display label per view type: the view tabs render the whole catalog from this, so every view is always offered. */
export const VIEW_LABELS: Record<ViewType, string> = { force: "force 3D", td: "top-down", lr: "left-right", gantt: "gantt", sequence: "sequence" };

/** The camera aim a view queues once its layout settles: front is the force-family default; gantt + sequence frame the
 *  lane plane (gantt looks down +x with time horizontal; sequence rolls 90° so participants read across and time down). */
export const REFRAME = {
	front: "front",
	gantt: "gantt",
	sequence: "sequence",
} as const;
export type ReframeMode = (typeof REFRAME)[keyof typeof REFRAME];

/** Every framing move the camera executes: the view aims (REFRAME) plus the two that are not view entries: `fit`
 *  re-frames the bounds keeping the user's orbit (the force family's fit), `side` faces the depth axis (the head's z
 *  rotate). One vocabulary, one camera dispatcher. */
export const FRAME = {
	...REFRAME,
	fit: "fit",
	side: "side",
} as const;
export type FrameMove = (typeof FRAME)[keyof typeof FRAME];

/** Coerce an arbitrary persisted string to a known view type, defaulting to the force view. */
export const asViewType = (v: string): ViewType => ((VIEW_TYPES as readonly string[]).includes(v) ? (v as ViewType) : VIEW.force);

/** The shape a view paints its participant nodes as: the three groups whose node objects differ: chips (force/td/lr),
 *  gantt duration bars, and sequence activation bars (the same bars, an upright name capping each lifeline). */
const nodeShapeClass = (v: ViewType): string => (v === VIEW.gantt ? "gantt-bar" : v === VIEW.sequence ? "sequence-bar" : "chip");

/** Does switching prev→next change the node SHAPE, so the lib's identity-cached node objects must be rebuilt? True across
 *  a shape-class boundary (force→sequence is chip→activation bar), false within one (force→td keeps the chips). Without
 *  the flag the actors keep stale chip objects on the first switch into the sequence: a pure decision, not a render fact. */
export const viewChangeRebuildsNodes = (prev: ViewType, next: ViewType): boolean => nodeShapeClass(prev) !== nodeShapeClass(next);
