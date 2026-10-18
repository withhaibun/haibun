/**
 * The variables a step set, read from the quads of the variables' records.
 */
import { SHARED_GRAPH, type TQuad } from "@haibun/core/lib/quad-types.js";
import { EDGE } from "@haibun/core/lib/domains/resources.js";
import { VARIABLE_FIELD } from "@haibun/core/lib/records/domains/variables.js";

/** One variable a step set: its name, the value its record holds, and the type of its record. */
export type TVariableSet = { name: string; value: unknown; graph: string };

/** Returns the variables a step set, from quads that hold the variables' records: each variable whose record has a
 *  `wasGeneratedBy` edge to the step's record. */
export function variablesSetBy(quads: readonly TQuad[], stepRecordName: string): TVariableSet[] {
	const ofVariables = quads.filter((q) => q.namedGraph === SHARED_GRAPH);
	const names = new Set(ofVariables.filter((q) => q.predicate === EDGE.wasGeneratedBy && q.object === stepRecordName).map((q) => q.subject));
	return [...names].map((name) => ({ name, value: ofVariables.find((q) => q.subject === name && q.predicate === VARIABLE_FIELD.value)?.object, graph: SHARED_GRAPH }));
}
