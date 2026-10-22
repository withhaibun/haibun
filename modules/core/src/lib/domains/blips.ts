/**
 * Blips record fine-grained occurrences for observation, and actuality doesn't retain them.
 *
 * Actuality retains the event log, and the monitor, the document, the report and an agent read it. A record per frame or
 * per row would grow that log without bound.
 *
 * A blip is an event of `kind: "blip"` on the event bus. The bus delivers it only to a subscriber that names that kind:
 * `subscribe(cb, { kinds: ["blip"] })`. `{ names }` narrows to declared names or dotted namespaces (`haibun.http`
 * matches `haibun.http.request`). A subscriber that doesn't name kinds never receives one, and the console never prints
 * one. `recordBlip` returns after one check where the name doesn't have a subscriber, so a caller can call it at any rate.
 *
 * Names are declared before use. `recordBlip` throws on an undeclared name that a subscriber watches. `dimensions` lists
 * the attributes that may become metric labels, and so bounds label cardinality. A blip carries the seqPath of the step in
 * flight when it is recorded, so an exporter attaches it to that step without context passed at the call site.
 */
import { z } from "zod";
import type { THaibunEvent, TBlipEvent } from "./protocol.js";
import type { IEventLogger } from "../steps/ports.js";
import type { TObserved } from "../steps/domains/stepper.js";

/** How a blip maps onto an OpenTelemetry signal. A discrete occurrence maps to a span event, and a rate or distribution
 *  maps to a metric instrument. Traces give order and identity, and metrics give frequency. */
type TBlipInstrument = "span-event" | "counter" | "histogram" | "gauge";

/** What may be recorded under a name: its instrument, what it measures, and the shape of every attribute it carries. */
export type TBlipDeclaration = {
	/** Dotted and namespaced, e.g. `haibun.shu.view.scroll`. Used by both exporters and queries, so it must be stable. */
	name: string;
	instrument: TBlipInstrument;
	/** What one recording means, for a reader of the declaration and of the exported signal. */
	description: string;
	/** UCUM unit for a measured value (`px`, `ms`, `1` for a count); omitted when a blip doesn't carry a value. */
	unit?: string;
	/** The attributes a recording carries. Validated on every record, so a key the schema doesn't declare can't reach an
	 *  exporter. */
	attributes?: z.ZodType<Record<string, unknown>>;
	/** Attributes that may become metric labels. All others stay on the span event, where cardinality doesn't matter. A
	 *  metrics backend stores one series per label combination, so unbounded label cardinality grows its storage without
	 *  bound. */
	dimensions?: readonly string[];
	/** Store the declaring `path:line`, so an occurrence name can be traced to its code. `declareBlips` reads the stack once
	 *  per call, and a recording doesn't read it. */
	origin?: boolean;
};

/** A stored declaration, with `declaredAt` when `origin` was set. */
type THeldBlipDeclaration = TBlipDeclaration & { declaredAt?: string };

const declarations = new Map<string, THeldBlipDeclaration>();

/** `path:line` of the first stack frame outside this module. Under a build this names the built file. */
function declaringSite(): string | undefined {
	const frames = (new Error().stack ?? "").split("\n").slice(1);
	for (const frame of frames) {
		if (/\/blips\.[jt]s:/.test(frame)) continue;
		const held = frame.match(/\(?(file:\/\/)?([^()\s]+):(\d+):\d+\)?$/);
		if (held) return `${held[2]}:${held[3]}`;
	}
	return undefined;
}

/** A declaration minus its attribute schema, in fixed order, so two declarations compare by content and don't depend on
 *  key order. */
const shapeOf = (d: TBlipDeclaration) => JSON.stringify([d.instrument, d.description, d.unit, d.dimensions]);

/**
 * Whether two attribute schemas are the same. Identical references match; otherwise they are compared as JSON Schema.
 * A schema that JSON Schema can't represent (a transform, a custom type) counts as different, so redeclaring it throws
 * and doesn't replace the schema other modules' recordings use.
 */
function sameAttributes(held: z.ZodType | undefined, incoming: z.ZodType | undefined): boolean {
	if (held === incoming) return true;
	if (!held || !incoming) return false;
	try {
		return JSON.stringify(z.toJSONSchema(held)) === JSON.stringify(z.toJSONSchema(incoming));
	} catch {
		return false;
	}
}

/**
 * Declares what may be recorded under a name. Redeclaring a name with a different instrument, description, unit,
 * dimensions or attribute schema throws. Replacing a stored declaration would remove attributes an earlier caller sends,
 * or make its recordings throw at a correct call site. Zod drops keys a schema doesn't declare.
 */
export function declareBlips(...decls: TBlipDeclaration[]): void {
	// One stack read per call: declarations in one call come from one module.
	const declaredAt = decls.some((d) => d.origin) ? declaringSite() : undefined;
	for (const d of decls) {
		const held = declarations.get(d.name);
		if (held && (shapeOf(held) !== shapeOf(d) || !sameAttributes(held.attributes, d.attributes)))
			throw new Error(`declareBlips: "${d.name}" is already declared with a different shape. Record under a different name, or make the two declarations the same.`);
		// Declaring the same declaration again keeps the held declaration and its `declaredAt`.
		if (!held) declarations.set(d.name, d.origin ? { ...d, declaredAt } : d);
	}
}

/** Returns the held declaration of a name, or undefined where the name isn't declared. */
export function blipDeclared(name: string): THeldBlipDeclaration | undefined {
	return declarations.get(name);
}

/** Every declaration, for an exporter that builds its instruments and for a reader that lists what actuality can record. */
export function blipDeclarations(): readonly THeldBlipDeclaration[] {
	return [...declarations.values()];
}

/**
 * Counts occurrences per name, for callers that can't read blips at their recorded rate: a feature assertion, the
 * monitor, an agent. Memory is one counter per recorded name. `blips-stepper` attaches it for actuality, clears it per
 * feature, and serves it as the `blips` observation source. A feature reads that source with `observed in`.
 */
export class BlipRollup {
	private counts = new Map<string, number>();
	private detachFn: (() => void) | undefined;

	/** Subscribes to `eventLogger`. It first unsubscribes from any earlier logger and clears the counts, so an actuality
	 *  that ends without detaching doesn't leave the next one subscribed to a discarded logger. */
	attach(eventLogger: IEventLogger): void {
		this.detach();
		this.counts.clear();
		const cb = (event: THaibunEvent) => {
			if (event.kind === "blip") this.counts.set(event.name, (this.counts.get(event.name) ?? 0) + 1);
		};
		eventLogger.subscribe(cb, { kinds: ["blip"] });
		this.detachFn = () => eventLogger.unsubscribe(cb);
	}

	detach(): void {
		this.detachFn?.();
		this.detachFn = undefined;
	}

	reset(): void {
		this.counts.clear();
	}

	/** The facts of an observation source: each name recorded, with the function `count`. */
	observe(): TObserved[] {
		return [...this.counts].map(([name, count]) => ({ subject: name, predicate: "count", object: count }));
	}
}

/** The one rollup actuality reads. The blips stepper's cycles attach and clear it. */
export const blipRollup = new BlipRollup();

/** How many occurrences a watch holds. The window is a fixed ring, so it can't grow, and a caller can record on every
 *  frame indefinitely. An occurrence the ring overwrites still counts toward `seen` and the series totals. */
export const WATCH_WINDOW = 200;

/** One series of a watch. It holds a name, a value of each dimension its declaration names, and the series' occurrence
 *  count. It also holds the sum and the maximum of the values its occurrences carry. */
export type TBlipSeries = { name: string; labels: Record<string, string>; count: number; sum?: number; max?: number };

/** Returns the series key, name and labels of an occurrence. The labels are its values of the declared dimensions. The
 *  declaration bounds their cardinality, so the series a watch keeps can't grow past what its names declare. */
function seriesOf(blip: TBlipEvent): { key: string; name: string; labels: Record<string, string> } {
	const labels: Record<string, string> = {};
	for (const dimension of declarations.get(blip.name)?.dimensions ?? []) {
		const value = blip.attributes?.[dimension];
		if (value !== undefined) labels[dimension] = String(value);
	}
	return { key: JSON.stringify([blip.name, labels]), name: blip.name, labels };
}

/**
 * An ordered window over named blips. The rollup counts occurrences per name. The watch holds their order. A
 * count loses that order, and a fine-grained occurrence is recorded to show it. The watch subscribes by name, so the
 * window holds only the named blips. A single per-frame name would otherwise replace every other occurrence in the
 * window.
 *
 * An agent requested to watch something receives this window. The window is bounded, so a model or a feature receives
 * at most `WATCH_WINDOW` occurrences however long actuality runs.
 */
class BlipWatch {
	private ring: TBlipEvent[] = [];
	private at = 0;
	private named: readonly string[] = [];
	private recorded = 0;
	private series = new Map<string, TBlipSeries>();
	private detachFn: (() => void) | undefined;

	/** Starts collecting the named blips, and replaces any earlier watch and its window. */
	start(eventLogger: IEventLogger, names: readonly string[]): void {
		this.stop();
		this.ring = [];
		this.at = 0;
		this.recorded = 0;
		this.series = new Map();
		this.named = [...names];
		const cb = (event: THaibunEvent) => {
			if (event.kind === "blip") this.hold(event);
		};
		eventLogger.subscribe(cb, { kinds: ["blip"], names });
		this.detachFn = () => eventLogger.unsubscribe(cb);
	}

	stop(): void {
		this.detachFn?.();
		this.detachFn = undefined;
	}

	/** The names passed to the last `start`. It is empty before the first `start`, and `stop` doesn't clear it. */
	get names(): readonly string[] {
		return this.named;
	}

	/** The number of occurrences recorded since the watch started, including those the ring overwrote. */
	get seen(): number {
		return this.recorded;
	}

	/** Returns every series the watch counted. The counts include the occurrences the ring overwrote. */
	totals(): readonly TBlipSeries[] {
		return [...this.series.values()];
	}

	/** The held occurrences, oldest first. */
	occurrences(): readonly TBlipEvent[] {
		return this.ring.length < WATCH_WINDOW ? [...this.ring] : [...this.ring.slice(this.at), ...this.ring.slice(0, this.at)];
	}

	private hold(blip: TBlipEvent): void {
		this.recorded++;
		this.count(blip);
		if (this.ring.length < WATCH_WINDOW) {
			this.ring.push(blip);
			return;
		}
		this.ring[this.at] = blip;
		this.at = (this.at + 1) % WATCH_WINDOW;
	}

	private count(blip: TBlipEvent): void {
		const { key, name, labels } = seriesOf(blip);
		const held = this.series.get(key) ?? { name, labels, count: 0 };
		held.count++;
		if (blip.value !== undefined) {
			held.sum = (held.sum ?? 0) + blip.value;
			held.max = Math.max(held.max ?? blip.value, blip.value);
		}
		this.series.set(key, held);
	}
}

/** The one watch actuality holds. The blips stepper's steps start and stop it. */
export const blipWatch = new BlipWatch();

/** Renders one occurrence as a line: ordinal, name, value, step, attributes. */
export function renderOccurrence(blip: TBlipEvent, index: number): string {
	const detail = (blip.attributes === undefined ? [] : Object.entries(blip.attributes)).map(([k, v]) => `${k}=${String(v)}`);
	const parts = [`${index + 1}`, blip.name, ...(blip.value === undefined ? [] : [`value=${blip.value}`]), ...(blip.seqPath ? [`step=${blip.seqPath}`] : []), ...detail];
	return parts.join(" ");
}
