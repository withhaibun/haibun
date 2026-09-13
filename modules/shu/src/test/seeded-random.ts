/**
 * Random numbers from a seed, for a test that runs a machine through random event sequences. The same seed gives the same
 * sequence, so a failing sequence is replayed by its seed.
 */

/** A generator of numbers in [0, 1) from the seed. */
export function seededRandom(seed: number): () => number {
	let at = seed;
	return () => {
		at = (at * 1_103_515_245 + 12_345) % 2_147_483_648;
		return at / 2_147_483_648;
	};
}

/** One item of the list, chosen by the generator. */
export const pickWith = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)];
