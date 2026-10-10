/**
 * The page's ring of blips: a fixed number of the latest occurrences, held in constant memory however long the page stays
 * open. The ring counts what it records and what it hands on, so a batch states what the ring dropped.
 */
import type { TBlipRing, TClientBlip } from "../ports.js";

/** Returns a ring that holds the latest `capacity` blips. */
export function blipRing(capacity: number): TBlipRing {
	let ring: TClientBlip[] = [];
	let next = 0;
	let recorded = 0;
	let sent = 0;
	return {
		record: (blip) => {
			recorded++;
			if (ring.length < capacity) ring.push(blip);
			else {
				ring[next] = blip;
				next = (next + 1) % capacity;
			}
		},
		take: () => {
			const taken = ring.length < capacity ? ring : [...ring.slice(next), ...ring.slice(0, next)];
			ring = [];
			next = 0;
			sent += taken.length;
			return taken;
		},
		recorded: () => recorded,
		sent: () => sent,
	};
}
