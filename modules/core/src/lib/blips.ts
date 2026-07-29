/**
 * Blips: fine-grained occurrences, recorded for observation and never retained by the run.
 *
 * The event log is retained (the monitor, the document, the report and an agent all read it), so anything recorded per
 * frame or per row would grow it without bound.
 *
 * A blip is emitted on the same event bus as `kind: "blip"` and delivered only to subscribers that name that kind:
 * `subscribe(cb, { kinds: ["blip"] })`. `{ names }` narrows to declared names or dotted namespaces (`haibun.http`
 * matches `haibun.http.request`). A subscriber that names no kinds never receives one, and the console never prints
 * one. With nothing subscribed to the name, `recordBlip` returns after one check, so it is safe to call at any rate.
 *
 * Names are declared before use: an undeclared name throws. `dimensions` lists the attributes that may become metric
 * labels, bounding label cardinality. A blip carries the seqPath it was recorded under, so an exporter can attach it
 * to that step without any context passed at the call site.
 */
import { z } from "zod";
import { BlipEvent } from "../schema/protocol.js";
import type { THaibunEvent, TBlipEvent } from "../schema/protocol.js";
import type { IEventLogger } from "./EventLogger.js";
import type { TWorld } from "./world.js";

/** How a blip maps onto an OpenTelemetry signal: a discrete occurrence is a span event, a rate or distribution is a
 *  metric instrument. Traces give order and identity; metrics give frequency. */
export type TBlipInstrument = "span-event" | "counter" | "histogram" | "gauge";

/** What may be recorded under a name: its instrument, what it measures, and the shape of every attribute it carries. */
export type TBlipDeclaration = {
	/** Dotted and namespaced, e.g. `haibun.shu.view.scroll`. Used by both exporters and queries, so it must be stable. */
	name: string;
	instrument: TBlipInstrument;
	/** What one recording means, for a reader of the declaration and of the exported signal. */
	description: string;
	/** UCUM unit for a measured value (`px`, `ms`, `1` for a count); omitted when a blip carries no value. */
	unit?: string;
	/** The attributes a recording carries. Validated on every record, so a stray key cannot reach an exporter. */
	attributes?: z.ZodType;
	/** Attributes that may become metric labels. All others stay on the span event, where cardinality does not matter.
	 *  Unbounded metric label cardinality overwhelms a metrics backend. */
	dimensions?: readonly string[];
	/** Store the declaring `path:line`, so an occurrence name can be traced to its code. Read once at declaration,
	 *  never per recording. */
	origin?: boolean;
};

/** A stored declaration, with `declaredAt` when `origin` was set. */
export type THeldBlipDeclaration = TBlipDeclaration & { declaredAt?: string };

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

/** A declaration minus its attribute schema, in fixed order, so two declarations compare by content not key order. */
const shapeOf = (d: TBlipDeclaration) => JSON.stringify([d.instrument, d.description, d.unit, d.dimensions]);

/**
 * Whether two attribute schemas are the same. Identical references match; otherwise they are compared as JSON Schema.
 * A schema JSON Schema cannot represent (a transform, a custom type) counts as different, so redeclaring it throws
 * rather than replacing a schema other modules record against.
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
 * Declare what may be recorded under a name. Redeclaring a name with a different instrument, unit, dimensions or
 * attribute schema throws. Replacing a stored declaration would silently strip attributes an earlier caller sends
 * (zod drops unknown keys), or make its recordings throw at a call site that is correct.
 */
export function declareBlips(...decls: TBlipDeclaration[]): void {
	// One stack read per call: declarations in one call come from one module.
	const declaredAt = decls.some((d) => d.origin) ? declaringSite() : undefined;
	for (const d of decls) {
		const held = declarations.get(d.name);
		if (held && (shapeOf(held) !== shapeOf(d) || !sameAttributes(held.attributes, d.attributes)))
			throw new Error(`declareBlips: "${d.name}" is already declared with a different shape — record under a different name, or reconcile the two declarations`);
		// The same declaration again keeps what is held, including where it was first declared.
		if (!held) declarations.set(d.name, d.origin ? { ...d, declaredAt } : d);
	}
}

/** Every declaration, for an exporter building its instruments and for a reader discovering what a run can record. */
export function blipDeclarations(): readonly THeldBlipDeclaration[] {
	return [...declarations.values()];
}

/** Drop every declaration. For a test. */
export function resetBlips(): void {
	declarations.clear();
}

/**
 * Counts occurrences per name, for callers that cannot consume blips at their recorded rate: a feature assertion, the
 * monitor, an agent. Memory is one counter per declared name. `blips-stepper` attaches it for the run, clears it per
 * feature, and serves it as the `blips` observation source, read with `observed in`.
 */
export class BlipRollup {
	private counts = new Map<string, number>();
	private detachFn: (() => void) | undefined;

	/** Subscribes to the given logger, unsubscribing from any earlier one and clearing counts. An execution that ends
	 *  without detaching must not leave the next one subscribed to a discarded logger. */
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

	/** Observation-source shape: items are the names recorded, each with a `count` metric. */
	observe(): { items: string[]; metrics: Record<string, Record<string, unknown>> } {
		const metrics: Record<string, Record<string, unknown>> = {};
		for (const [name, count] of this.counts) metrics[name] = { count };
		return { items: [...this.counts.keys()], metrics };
	}
}

/** The one rollup a run reads, attached and cleared by the blips stepper's cycles. */
export const blipRollup = new BlipRollup();

/** How many occurrences a watch holds. A fixed ring, so the window cannot grow: the same property that lets a hot path
 *  record forever. What falls out is counted, never silently dropped. */
export const WATCH_WINDOW = 200;

/**
 * A focused, ordered window over named blips. The rollup answers how many; this answers in what order, which is the
 * question a fine-grained occurrence exists to settle and the one a count destroys. Subscribing by name is what keeps
 * the window worth reading: a single per-frame name would otherwise flood out everything else it holds.
 *
 * This is what an agent asked to watch something receives. It is bounded, so handing it to a model or a feature costs
 * a known amount however long the run goes on.
 */
export class BlipWatch {
	private ring: TBlipEvent[] = [];
	private at = 0;
	private named: readonly string[] = [];
	private recorded = 0;
	private detachFn: (() => void) | undefined;

	/** Start collecting the named blips, replacing any earlier watch and its window. */
	start(eventLogger: IEventLogger, names: readonly string[]): void {
		this.stop();
		this.ring = [];
		this.at = 0;
		this.recorded = 0;
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

	/** The names being watched, empty when nothing is. */
	get names(): readonly string[] {
		return this.named;
	}

	/** Every occurrence recorded since the watch started, including any the window has since dropped. */
	get seen(): number {
		return this.recorded;
	}

	/** The held occurrences, oldest first. */
	occurrences(): readonly TBlipEvent[] {
		return this.ring.length < WATCH_WINDOW ? [...this.ring] : [...this.ring.slice(this.at), ...this.ring.slice(0, this.at)];
	}

	private hold(blip: TBlipEvent): void {
		this.recorded++;
		if (this.ring.length < WATCH_WINDOW) {
			this.ring.push(blip);
			return;
		}
		this.ring[this.at] = blip;
		this.at = (this.at + 1) % WATCH_WINDOW;
	}
}

/** The one watch a run holds, started and stopped by the blips stepper's steps. */
export const blipWatch = new BlipWatch();

/**
 * Record an occurrence onto the event bus. With nothing subscribed to this name this is one check and a return —
 * the reason a hot path can record unconditionally. With a matching subscriber, the name must be declared and the
 * attributes must match the declared shape.
 */
export function recordBlip(world: TWorld, name: string, value?: number, attributes?: Record<string, unknown>): void {
	if (!world.eventLogger.hasSubscribers("blip", name)) return;
	const declared = declarations.get(name);
	if (!declared) throw new Error(`recordBlip: "${name}" is not declared — declare it with declareBlips before recording it`);
	// What the declaration validated is what is emitted, so a key it does not name cannot ride along to an exporter, and
	// omitting attributes a declaration requires is caught here rather than downstream.
	const declaredAttributes = declared.attributes ? (declared.attributes.parse(attributes ?? {}) as Record<string, unknown>) : attributes;
	const timestamp = Date.now();
	const seqPath = world.runtime.currentSeqPath;
	// emitter is set here so emit() never walks a stack for a per-frame recording.
	world.eventLogger.emit(
		BlipEvent.parse({
			id: seqPath ? `${seqPath}.blip.${timestamp}` : `blip.${timestamp}`,
			timestamp,
			kind: "blip",
			level: "trace",
			emitter: "blips.recordBlip",
			name,
			seqPath,
			value,
			attributes: declaredAttributes,
		}),
	);
}
