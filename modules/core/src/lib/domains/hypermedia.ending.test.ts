/**
 * What a start-up writes in a record that an interrupted actuality left without an end. An instrumentation type that states
 * an end states the fields the start-up writes: its status, the step that ended it and its actuality.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildResourceRels } from "./hypermedia.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { Access, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";
import { LOG_MESSAGE_LABEL, logMessageDomainDefinition } from "./log-message.js";
import { ENDED_BY_FIELD, ACTUALITY_FIELD, SEQ_PATH_FIELD, seqPathDomainDefinition } from "../actuality/domains/seq-path.js";
import { URAKATA_LABEL } from "./urakata.js";
import { urakataTaskDomainDefinition } from "../../steps/urakata-stepper.js";

/** A type that states an end, with the instrumentation flag `instrumentation` and the properties `extra` beside its id, its
 *  times and its end. */
const ended = (label: string, instrumentation: boolean, extra: Record<string, string>): TDomainDefinition => ({
	selectors: [label.toLowerCase()],
	schema: PersistedVertexSchema.extend({
		id: z.string(),
		generatedAtTime: z.string(),
		endedAtTime: z.string().optional(),
		...Object.fromEntries(Object.keys(extra).map((field) => [field, z.string()])),
	}),
	description: `A type that states an end, ${label}`,
	topology: {
		persistedAs: label,
		accessLevel: Access.private,
		id: "id",
		instrumentation,
		properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, endedAtTime: LinkRelations.ENDED_AT_TIME.rel, ...extra },
	},
});

describe("what a start-up writes in a record an interrupted actuality left without an end", () => {
	const rels = buildResourceRels(mapDefinitionsToDomains([seqPathDomainDefinition, urakataTaskDomainDefinition, logMessageDomainDefinition, ended("Task", false, {})]));

	it("is a step's end, status, ender and time of writing, by its actuality", () => {
		expect(rels.ending(SEQ_PATH_LABEL)).toEqual({
			end: SEQ_PATH_FIELD.endedAtTime,
			status: SEQ_PATH_FIELD.actionStatus,
			endedBy: ENDED_BY_FIELD,
			actuality: ACTUALITY_FIELD,
			recordedAt: SEQ_PATH_FIELD.recordedAtTime,
		});
	});

	it("is a background task's stoppedAt, status and ender, by its actuality, since it doesn't state a time of writing", () => {
		expect(rels.ending(URAKATA_LABEL)).toEqual({ end: "stoppedAt", status: "actionStatus", endedBy: ENDED_BY_FIELD, actuality: ACTUALITY_FIELD });
	});

	it("isn't stated for a type without an end, or for a feature's data that states one", () => {
		expect(rels.ending(LOG_MESSAGE_LABEL)).toBeUndefined();
		expect(rels.ending("Task")).toBeUndefined();
	});

	it("refuses an instrumentation type that states its status and isn't counted by it, since the retention's counts state how removed records ended", () => {
		const uncounted = ended("Probe", true, {
			actionStatus: LinkRelations.ACTION_STATUS.rel,
			[ENDED_BY_FIELD]: LinkRelations.WAS_ENDED_BY.rel,
			[ACTUALITY_FIELD]: LinkRelations.CONTEXT.rel,
		});
		expect(() => buildResourceRels(mapDefinitionsToDomains([uncounted]))).toThrow("Probe states its status in actionStatus and isn't counted by it");
		expect(rels.countedBy(URAKATA_LABEL), "a background task is counted by how it ended").toContain("actionStatus");
	});

	it("refuses an instrumentation type that states an end without its status, its ender and its actuality, and names them", () => {
		expect(() => buildResourceRels(mapDefinitionsToDomains([ended("Probe", true, { [ACTUALITY_FIELD]: LinkRelations.CONTEXT.rel })]))).toThrow(
			`Probe states its end in endedAtTime, and doesn't map a property to each of ${LinkRelations.ACTION_STATUS.rel}, ${LinkRelations.WAS_ENDED_BY.rel} and ${ACTUALITY_FIELD}`,
		);
	});
});
