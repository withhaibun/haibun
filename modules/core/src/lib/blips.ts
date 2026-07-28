/**
 * Blips — fine-grained occurrences recorded for observation, never for the run's narrative.
 *
 * The event log is RETAINED: the monitor renders it, the document reads it, the report replays it, an agent takes it as
 * context. Anything recorded per frame or per row would grow it without bound, which is why a measurement like "this
 * view moved a pixel after the cascade settled" has had nowhere to go and has been debugged by hand instead.
 *
 * A blip is the opposite: it is NEVER retained. It rides the one event bus as `kind: "blip"`, delivered only to a
 * subscriber that asked for that kind (`eventLogger.subscribe(cb, { kinds: ["blip"] })`) — an exporter mapping it onto
 * an OpenTelemetry span event, an agent watching for a condition. `{ names }` narrows a subscription to declared names
 * or dotted namespaces (`haibun.http` matches `haibun.http.request`). A bare subscriber never receives one, the console
 * never prints one, and with nothing subscribed to the name, recording costs one check and returns. That is what makes
 * it safe to leave recording in a hot path permanently.
 *
 * Every blip is DECLARED before it can be recorded: a name, what it measures, and the shape of its attributes. An
 * undeclared name throws rather than inventing a vocabulary at the call site, and `dimensions` names the attributes that
 * may become metric labels, so unbounded label cardinality (the way a metrics backend is overwhelmed) cannot be reached
 * by accident. Causality comes from the run's own spine: a blip carries the seqPath it happened under, so an exporter
 * attaches it to that step's span without any context threading at the call site.
 */
import { z } from "zod";
import { BlipEvent } from "../schema/protocol.js";
import type { THaibunEvent, TBlipEvent } from "../schema/protocol.js";
import type { IEventLogger } from "./EventLogger.js";
import type { TWorld } from "./world.js";

/** How a blip maps onto an OpenTelemetry signal. A discrete occurrence within an operation is a span event; a rate or a
 *  distribution is a metric instrument. Traces answer "which one and in what order", metrics answer "how often". */
export type TBlipInstrument = "span-event" | "counter" | "histogram" | "gauge";

/** What may be recorded under a name: its instrument, what it measures, and the shape of every attribute it carries. */
export type TBlipDeclaration = {
	/** Dotted, namespaced, stable — the name an exporter and a query both use, e.g. `haibun.shu.view.scroll_adjust`. */
	name: string;
	instrument: TBlipInstrument;
	/** What one recording means, for a reader of the declaration and of the exported signal. */
	description: string;
	/** UCUM unit for a measured value (`px`, `ms`, `1` for a count); omitted when a blip carries no value. */
	unit?: string;
	/** The attributes a recording carries. Validated on every record, so a stray key cannot reach an exporter. */
	attributes?: z.ZodType;
	/** The attributes that may become metric labels. Every other attribute stays on the span event, where high
	 *  cardinality is free; a metric label of unbounded cardinality is what overwhelms a backend. */
	dimensions?: readonly string[];
};

const declarations = new Map<string, TBlipDeclaration>();

/** Everything a declaration says except its attribute schema, in a fixed order so two declarations compare by content. */
const shapeOf = (d: TBlipDeclaration) => JSON.stringify([d.instrument, d.description, d.unit, d.dimensions]);

/**
 * Whether two attribute schemas are the same. The same schema is trivially the same; otherwise they are compared as
 * JSON Schema. A schema that cannot be represented that way (a transform, a custom type) cannot be shown to be
 * identical, and an unprovable case is treated as different, so declaring one throws rather than silently replacing a
 * vocabulary other modules already record against.
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
 * Declare what may be recorded under a name. Re-declaring the same name with anything different, its instrument, its
 * unit, its dimensions or its attribute schema, throws: one name means one thing across every module that records or
 * reads it. Replacing a held declaration would strip the attributes an earlier caller declared and sends, or make its
 * recordings throw at a site that reads as correct, so the collision is refused where it is written.
 */
export function declareBlips(...decls: TBlipDeclaration[]): void {
	for (const d of decls) {
		const held = declarations.get(d.name);
		if (held && (shapeOf(held) !== shapeOf(d) || !sameAttributes(held.attributes, d.attributes)))
			throw new Error(`declareBlips: "${d.name}" is already declared with a different shape — record under a different name, or reconcile the two declarations`);
		declarations.set(d.name, d);
	}
}

/** Every declaration, for an exporter building its instruments and for a reader discovering what a run can record. */
export function blipDeclarations(): readonly TBlipDeclaration[] {
	return [...declarations.values()];
}

/** Drop every declaration. For a test. */
export function resetBlips(): void {
	declarations.clear();
}

/**
 * The aggregating listener: rolls occurrences up per name, since neither a feature line, the monitor, nor an agent can
 * take blips raw. Memory is bounded by the declared vocabulary (one counter per name). LogicStepper attaches it for
 * the run and serves it as the `blips` observation source, so a feature asserts on counts with the existing
 * `observed in` quantifiers; it clears between features like every observation source.
 */
export class BlipRollup {
	private counts = new Map<string, number>();
	private detachFn: (() => void) | undefined;

	/** Binds to the logger passed in, dropping any earlier subscription: an execution that ends without detaching (a
	 *  throw that escapes the feature loop) must not leave the next one counting against a dead logger. Opens a clean
	 *  window, like the observation graphs an execution clears at its start. */
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

	/** The rollup in observation-source shape: items are the names seen, each with its occurrence count as a metric. */
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
