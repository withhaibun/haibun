/**
 * The affordances a test gives a view, as the step that shows them returns them: every field the schema declares, empty
 * except those the test states.
 */
import type { z } from "zod";
import type { ApplicableStepsSchema } from "@haibun/core/lib/domains/goal-resolution.js";
import { HYPERMEDIA, TRACE_SEQ_PATH } from "@haibun/core/lib/domains/protocol.js";

/** The affordances as the step that shows them returns them, before a reader parses them. */
export type TOffered = z.input<typeof ApplicableStepsSchema>;
/** A plan toward a goal, as the affordances state it. */
export type TOfferedPlan = TOffered["goals"][number]["resolution"]["plans"][number];
/** A step the affordances offer. */
type TOfferedStep = TOffered["forward"][number];

/** Returns the affordances of the actuality `actuality`, empty except what `offered` states. */
export const offeredSteps = (actuality: string, offered: Partial<TOffered> = {}): TOffered => ({
	actuality,
	findings: [],
	satisfiedDomains: [],
	satisfiedFacts: {},
	composites: {},
	waypoints: [],
	forward: [],
	goals: [],
	...offered,
});

/** Returns the step `stepperName`'s `stepName` as the affordances offer it: ready to run, with an empty list of inputs, returning `outputs`. */
export const offeredStep = (stepperName: string, stepName: string, outputs: string[]): TOfferedStep => ({
	method: `${stepperName}-${stepName}`,
	stepperName,
	stepName,
	inputDomains: [],
	outputDomains: outputs,
	readyToRun: true,
	capability: `${stepperName}:${stepName}`,
});

/** Returns a goal of the domain `domain` whose verdict is unknown, with an empty list of facts and of plans. */
export const unknownGoal = (domain: string): TOffered["goals"][number] => ({
	domain,
	description: domain,
	resolution: { goal: domain, verdict: "unknown", factIds: [], plans: [] },
});

/** Returns what dispatch adds to the products of a step whose domain `domain` the component `component` shows, as
 *  `augmentViewHypermedia` adds it: the trace and the markers, which name the component and the pane that show them. */
export const dispatchMarkers = (domain: string, component: string): Record<string, unknown> => ({
	[TRACE_SEQ_PATH]: [0, 1],
	[HYPERMEDIA.TYPE]: component,
	[HYPERMEDIA.SUMMARY]: domain,
	[HYPERMEDIA.DESCRIPTION]: domain,
	[HYPERMEDIA.COMPONENT]: component,
	[HYPERMEDIA.VIEW]: domain,
	[HYPERMEDIA.LINKS]: {},
});
