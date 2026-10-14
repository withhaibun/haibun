/**
 * Announces a quad a store wrote, as a quad observation event on actuality's stream.
 */
import type { IEventLogger } from "../ports.js";
import type { TQuad } from "../domains/quad-types.js";
import { ellipsize } from "../../util/index.js";

/** The most of a string value a quad OBSERVATION carries. Events carry references and previews, never payloads:
 *  an emitted body would otherwise ride into every event buffer and SSE frame (a first-time index of a large
 *  mailbox measured in gigabytes). The store keeps the full value; a consumer that needs it dereferences. */
export const OBSERVATION_VALUE_MAX = 512;

/** Emit a quadObservation event via an event logger. Canonical envelope for all quad emissions; string values are
 *  bounded to OBSERVATION_VALUE_MAX and marked `preview: true` (the store holds the payload: a consumer that needs
 *  it dereferences deliberately, and a merge can prefer a full value over a preview). Untruncated quads pass by
 *  reference: the write path doesn't clone per emission. */
export function emitQuadObservation(logger: Pick<IEventLogger, "emit">, id: string, quad: TQuad): void {
	const bounded = typeof quad.object === "string" && quad.object.length > OBSERVATION_VALUE_MAX;
	const observed = bounded ? { ...quad, object: ellipsize(quad.object as string, OBSERVATION_VALUE_MAX), properties: { ...quad.properties, preview: true } } : quad;
	logger.emit({
		id,
		timestamp: quad.timestamp,
		source: "haibun",
		level: "debug",
		kind: "artifact",
		artifactType: "json",
		mimetype: "application/json",
		json: { quadObservation: observed },
	});
}
