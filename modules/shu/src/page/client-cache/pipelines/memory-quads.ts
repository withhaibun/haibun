/**
 * The quads of an actuality a report carries, held in memory: a report is opened from a file, where every report shares one
 * origin, so a report that held its actuality on the device would mix it with the next report's. A fact is held once under
 * its subject, predicate and graph, as the device's database holds it, and a read of a graph or a subject reads only those
 * quads through core's layer.
 */
import { matchesQuadPattern, type TQuad, type TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { QuadLayer } from "@haibun/core/lib/records/machines/quad-layer.js";
import type { TDeviceQuads, TGraphSaturation } from "../ports.js";

export class MemoryQuads implements TDeviceQuads {
	readonly #layer = new QuadLayer();

	/** `database` names the actuality the quads are of, and `bound` is the most quads the graph states it holds. */
	constructor(
		readonly database: string,
		private readonly bound: number,
	) {}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		return this.query({ subject, predicate, namedGraph }).then((held) => held.at(-1)?.object);
	}

	add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		this.#layer.add({ ...quad, timestamp: Date.now() });
		return Promise.resolve();
	}

	query(pattern: TQuadPattern): Promise<TQuad[]> {
		return Promise.resolve([...this.#layer.candidates(pattern)].filter((quad) => matchesQuadPattern(quad, pattern)));
	}

	clear(namedGraph?: string): Promise<void> {
		if (namedGraph === undefined) this.#layer.clear();
		else this.#layer.removeWhere(this.#layer.ofGraph(namedGraph), () => true);
		return Promise.resolve();
	}

	remove(pattern: TQuadPattern): Promise<void> {
		this.#layer.removeWhere(this.#layer.candidates(pattern), (quad) => matchesQuadPattern(quad, pattern));
		return Promise.resolve();
	}

	all(): Promise<TQuad[]> {
		return Promise.resolve([...this.#layer]);
	}

	/** Holds each fact, replacing what is held under its subject, predicate and graph. */
	setMany(quads: TQuad[]): Promise<void> {
		for (const quad of quads) {
			this.#layer.removeWhere(this.#layer.ofSubject(quad.namedGraph, quad.subject), (held) => held.predicate === quad.predicate);
			this.#layer.add(quad);
		}
		return Promise.resolve();
	}

	saturation(): Promise<TGraphSaturation> {
		return Promise.resolve({ held: [...this.#layer].length, bound: this.bound, dropped: 0 });
	}
}
