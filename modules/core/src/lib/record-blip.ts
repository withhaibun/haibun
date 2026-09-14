/**
 * Recording a blip, which a run does inside a step: the occurrence names the step it happened in. Declaring a blip is
 * shared with the page, which declares what it records; recording reads the step in flight, which only a run has.
 */
import { BlipEvent } from "../schema/protocol.js";
import type { TWorld } from "./world.js";
import { stepInFlight } from "./capability-context.js";
import { blipDeclared } from "./blips.js";

/**
 * Record an occurrence onto the event bus. With nothing subscribed to this name this is one check and a return:
 * the reason a hot path can record unconditionally. With a matching subscriber, the name must be declared and the
 * attributes must match the declared shape.
 */
export function recordBlip(world: TWorld, name: string, value?: number, attributes?: Record<string, unknown>): void {
	if (!world.eventLogger.hasSubscribers("blip", name)) return;
	const declared = blipDeclared(name);
	if (!declared) throw new Error(`recordBlip: "${name}" is not declared, declare it with declareBlips before recording it`);
	// What the declaration validated is what is emitted, so a key it does not name cannot ride along to an exporter, and
	// omitting attributes a declaration requires is caught here rather than downstream.
	const declaredAttributes = declared.attributes ? (declared.attributes.parse(attributes ?? {}) as Record<string, unknown>) : attributes;
	const timestamp = Date.now();
	const seqPath = stepInFlight()?.seqPath;
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
