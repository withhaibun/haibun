/**
 * Blips — fine-grained occurrences recorded for observation, never for the run's narrative.
 *
 * The event log is RETAINED: the monitor renders it, the document reads it, the report replays it, an agent takes it as
 * context. Anything recorded per frame or per row would grow it without bound, which is why a measurement like "this
 * view moved a pixel after the cascade settled" has had nowhere to go and has been debugged by hand instead.
 *
 * A blip is the opposite: it is NEVER retained here. It is handed to whatever listeners are registered — an exporter
 * mapping it onto an OpenTelemetry span event, an agent watching for a condition — and if nothing is listening it costs
 * one boolean test and returns. That is what makes it safe to leave recording in a hot path permanently.
 *
 * Every blip is DECLARED before it can be recorded: a name, what it measures, and the shape of its attributes. An
 * undeclared name throws rather than inventing a vocabulary at the call site, and `dimensions` names the attributes that
 * may become metric labels, so unbounded label cardinality (the way a metrics backend is overwhelmed) cannot be reached
 * by accident. Causality comes from the run's own spine: a blip carries the seqPath it happened under, so an exporter
 * attaches it to that step's span without any context threading at the call site.
 */
import { z } from "zod";
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

/** One recorded occurrence: what happened, under which step, and with what detail. */
export type TBlip = {
	name: string;
	/** The step the run was executing, so an exporter attaches this to that step's span. */
	seqPath?: string;
	/** The measured value, in the declaration's unit. Absent for a blip that only marks that something happened. */
	value?: number;
	attributes?: Record<string, unknown>;
	timestamp: number;
};

export type TBlipListener = (blip: TBlip) => void;

const declarations = new Map<string, TBlipDeclaration>();
let listeners: TBlipListener[] = [];

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

/** Register a listener — an exporter, an agent. Returns its removal, so a stepper detaches at the end of its run. */
export function listenForBlips(listener: TBlipListener): () => void {
	listeners = [...listeners, listener];
	return () => {
		listeners = listeners.filter((l) => l !== listener);
	};
}

/** Drop every listener and declaration. For a test, and for an execution that ends. */
export function resetBlips(): void {
	listeners = [];
	declarations.clear();
}

/**
 * Record an occurrence. With nothing listening this is a boolean test and a return — the reason a hot path can record
 * unconditionally. With a listener, the name must be declared and the attributes must match the declared shape.
 */
export function recordBlip(world: TWorld, name: string, value?: number, attributes?: Record<string, unknown>): void {
	if (listeners.length === 0) return;
	const declared = declarations.get(name);
	if (!declared) throw new Error(`recordBlip: "${name}" is not declared — declare it with declareBlips before recording it`);
	if (declared.attributes && attributes !== undefined) declared.attributes.parse(attributes);
	const blip: TBlip = { name, seqPath: world.runtime.currentSeqPath, value, attributes, timestamp: Date.now() };
	for (const listener of listeners) listener(blip);
}
