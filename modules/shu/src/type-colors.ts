/**
 * Single source of truth for vertex-type colors. Both shu-graph-view (mermaid
 * subgraph fills) and shu-fisheye-graph-view (3D plate colors) call
 * `colorForType(typeName)` so the same vertex type gets the same colour
 * regardless of which view a user is looking at — important for cross-view
 * pattern-matching (an Email is the same colour everywhere).
 *
 * Mapping is deterministic per type *name*: a hash of the string indexes into
 * the palette, so loading a different subset of types doesn't reshuffle
 * colours, and a type's colour is stable across page reloads.
 */

/** 24-colour palette — broad enough that a typical schema (under ~20 vertex types) gets distinct colours, with collision-resistant spacing across the wheel. */
export const TYPE_PALETTE: ReadonlyArray<string> = [
	"#8ecae6", // pale blue
	"#ffb703", // amber
	"#90be6d", // green
	"#f28482", // coral
	"#cdb4db", // lavender
	"#bde0fe", // sky
	"#ffd6a5", // peach
	"#80ed99", // mint
	"#ff9b85", // salmon
	"#a3c4f3", // periwinkle
	"#fff3b0", // straw
	"#b5ead7", // sea-foam
	"#c9b1ff", // lilac
	"#ffaad8", // pink
	"#a0e7e5", // aqua
	"#fbc4ab", // sand
	"#d4a5a5", // mauve
	"#9bf6ff", // cyan
	"#fdffb6", // pale yellow
	"#caffbf", // pale green
	"#ffadad", // rose
	"#bdb2ff", // violet
	"#c1e1c1", // sage
	"#ffd8be", // apricot
];

function hashString(s: string): number {
	// Small djb2 — sufficient distribution for an 8-colour palette and stable
	// across runs (no Math.random, no Date).
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
	return h >>> 0;
}

export function colorForType(typeName: string): string {
	if (!typeName) return TYPE_PALETTE[0];
	return TYPE_PALETTE[hashString(typeName) % TYPE_PALETTE.length];
}
