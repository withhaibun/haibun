/**
 * A stable hash of the visible graph model — the "unchanged-model skip" that lets a data merge avoid reheating the
 * layout when it brought nothing new. Node identity + name + link endpoints. In gantt view the time z (the model's
 * calendar position, a faithful function of each task's scheduled time) is mixed in too, so a reschedule — which leaves
 * the node/link set untouched but moves bars along the time axis — registers as a genuine model change and repaints.
 * `extra` folds in a non-model scalar that nonetheless reshapes the rendering — the scrub time cursor, which re-places
 * every node's depth without touching the node/link set; without it, a scrub would hit the unchanged-model skip and the
 * view would only refresh on an incidental resize. Pure arithmetic, unit-tested without a scene.
 */
export type HashNode = { id: string; name: string; z?: number };
export type HashLink = { source: string | { id: string }; target: string | { id: string }; predicate: string };

const SEP = String.fromCharCode(0); // NUL: can't appear in an id/predicate, so distinct links never collide
const endId = (e: string | { id: string }): string => (typeof e === "string" ? e : e.id);
/** One identity for a link — the unchanged-model skip and the fresh-link detection must agree on it. */
export const linkKey = (l: HashLink): string => `${endId(l.source)}${SEP}${l.predicate}${SEP}${endId(l.target)}`;

export function hashModel(nodes: HashNode[], links: HashLink[], mixZ = false, extra?: number | null): number {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	const mix = (s: string): void => {
		for (let i = 0; i < s.length; i++) {
			const ch = s.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ 0x1f, 2654435761); // field terminator: ("ab","c") must differ from ("a","bc")
	};
	for (const n of nodes) {
		mix(n.id);
		mix(n.name);
		if (mixZ) mix(String(Math.round(n.z ?? 0))); // gantt: the calendar position is part of the model
	}
	for (const l of links) mix(linkKey(l));
	if (extra != null) mix(String(extra)); // the scrub cursor (live/null folds nothing, so live streaming is unaffected)
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
