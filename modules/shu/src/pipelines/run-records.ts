/**
 * What actuality logs and produces, written as records under the step in which it happened. A reader receives a statement as
 * actuality logs it, over the stream; the record is the durable copy a reader reads afterwards. A record's type declares
 * that writing it isn't announced, so a statement logged once is announced once.
 */
import type { TTag } from "@haibun/core/lib/domains/ttag.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { TArtifactEvent, THaibunEvent } from "@haibun/core/lib/domains/protocol.js";
import { executionOf, extractSeqPathPrefix, formatRecordName, parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { LOG_MESSAGE_EDGE, LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { RUN_ARTIFACT_EDGE, RUN_ARTIFACT_FIELD, RUN_ARTIFACT_LABEL } from "@haibun/core/lib/domains/run-artifact.js";

/** The step an event happened in, as the path actuality walks. An event that doesn't name a step has an empty path. */
function stepOf(e: THaibunEvent): number[] {
	const path = extractSeqPathPrefix(e.id);
	if (path === null) return [];
	const parsed = parseSeqPath(path);
	if (parsed === null) throw new Error(`the event ${e.id} names the step ${path}, which isn't a seqPath`);
	return parsed;
}

/** The record name of the step an event happened in, or undefined where the event doesn't name a step. */
function underStep(tag: TTag, e: THaibunEvent): string | undefined {
	const path = stepOf(e);
	return path.length === 0 ? undefined : formatRecordName({ execution: executionOf(tag), path });
}

/** A record's name: its execution, the step it came from, and which of that step's records it is. */
const recordName = (tag: TTag, e: THaibunEvent, ordinal: number): string => formatRecordName({ execution: executionOf(tag), path: stepOf(e), ordinal });

/** Writes what actuality logged as the `ordinal`th statement of the feature. A log event without a message text isn't a statement. */
export async function recordSaid(world: TWorld, e: Extract<THaibunEvent, { kind: "log" }>, ordinal: number): Promise<void> {
	if (typeof e.message !== "string") return;
	const said = underStep(world.tag, e);
	await world.shared
		.getStore()
		.upsertIndividual(LOG_MESSAGE_LABEL, {
			[LOG_MESSAGE_FIELD.id]: recordName(world.tag, e, ordinal),
			[LOG_MESSAGE_FIELD.execution]: executionOf(world.tag),
			[LOG_MESSAGE_FIELD.recordedAtTime]: new Date().toISOString(),
			[LOG_MESSAGE_FIELD.message]: e.message,
			[LOG_MESSAGE_FIELD.level]: e.level,
			[LOG_MESSAGE_FIELD.generatedAtTime]: new Date(e.timestamp).toISOString(),
			...(said === undefined ? {} : { [LOG_MESSAGE_EDGE.isPartOf]: said }),
		});
}

/**
 * Writes what actuality produced as the `ordinal`th artifact of the feature. The record states where the artifact is and
 * what it is, not what it holds: an artifact is a file, and its record points at the file. An artifact without a path,
 * such as a trace of actuality's own machinery, isn't a file actuality produced, and the graph holds it as its own type.
 */
export async function recordProduced(world: TWorld, e: TArtifactEvent, ordinal: number): Promise<void> {
	if (!("path" in e) || typeof e.path !== "string") return;
	const under = underStep(world.tag, e);
	await world.shared
		.getStore()
		.upsertIndividual(RUN_ARTIFACT_LABEL, {
			[RUN_ARTIFACT_FIELD.id]: recordName(world.tag, e, ordinal),
			[RUN_ARTIFACT_FIELD.execution]: executionOf(world.tag),
			[RUN_ARTIFACT_FIELD.recordedAtTime]: new Date().toISOString(),
			[RUN_ARTIFACT_FIELD.artifactType]: e.artifactType,
			[RUN_ARTIFACT_FIELD.path]: e.path,
			...(typeof e.featureRelativePath === "string" ? { [RUN_ARTIFACT_FIELD.featureRelativePath]: e.featureRelativePath } : {}),
			...(typeof e.mimetype === "string" ? { [RUN_ARTIFACT_FIELD.mediaType]: e.mimetype } : {}),
			[RUN_ARTIFACT_FIELD.generatedAtTime]: new Date(e.timestamp).toISOString(),
			[RUN_ARTIFACT_FIELD.level]: e.level,
			...(under === undefined ? {} : { [RUN_ARTIFACT_EDGE.isPartOf]: under }),
		});
}
