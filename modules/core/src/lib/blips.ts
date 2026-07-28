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

/** Declare what may be recorded under a name. Re-declaring the same name with a different shape throws: one name means
 *  one thing across every module that records or reads it. */
export function declareBlips(...decls: TBlipDeclaration[]): void {
	for (const d of decls) {
		const held = declarations.get(d.name);
		if (held && JSON.stringify({ ...held, attributes: undefined }) !== JSON.stringify({ ...d, attributes: undefined }))
			throw new Error(`declareBlips: "${d.name}" is already declared with a different shape`);
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
 * Record an occurrence onto the event bus. With nothing subscribed to this name this is one check and a return —
 * the reason a hot path can record unconditionally. With a matching subscriber, the name must be declared and the
 * attributes must match the declared shape.
 */
export function recordBlip(world: TWorld, name: string, value?: number, attributes?: Record<string, unknown>): void {
	if (!world.eventLogger.hasSubscribers("blip", name)) return;
	const declared = declarations.get(name);
	if (!declared) throw new Error(`recordBlip: "${name}" is not declared — declare it with declareBlips before recording it`);
	if (declared.attributes && attributes !== undefined) declared.attributes.parse(attributes);
	const timestamp = Date.now();
	const seqPath = world.runtime.currentSeqPath;
	// emitter is set here so emit() never walks a stack for a per-frame recording.
	world.eventLogger.emit(
		BlipEvent.parse({ id: seqPath ? `${seqPath}.blip.${timestamp}` : `blip.${timestamp}`, timestamp, kind: "blip", level: "trace", emitter: "blips.recordBlip", name, seqPath, value, attributes }),
	);
}
