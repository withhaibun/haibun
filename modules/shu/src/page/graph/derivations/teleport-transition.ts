/**
 * Where a virtual neighbour chip is while the ego overlay fades: on the line from its real node to its place at the margin,
 * at the share the fade's eased opacity states, with an opacity that rises from `TELEPORT_OPACITY.min`. A chip starts at its
 * node's place and reaches the margin at the end of the fade-in.
 */
import type { XYZ } from "../domains/graph-types.js";

export const TELEPORT_OPACITY = { min: 0.35, max: 1 } as const;

/** Returns the place and the opacity of a chip at share `share` of its move from `source` to `target`. */
export function teleportStation(source: XYZ, target: XYZ, share: number): { pos: XYZ; opacity: number } {
	const pos = { x: source.x + share * (target.x - source.x), y: source.y + share * (target.y - source.y), z: source.z + share * (target.z - source.z) };
	return { pos, opacity: share === 0 ? 0 : TELEPORT_OPACITY.min + share * (TELEPORT_OPACITY.max - TELEPORT_OPACITY.min) };
}
