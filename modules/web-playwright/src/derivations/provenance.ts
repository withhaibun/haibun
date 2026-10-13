/** The provenance of a variable a step writes: the step's line, its position and its name, as the variables stepper states a step's provenance. */
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TProvenanceIdentifier } from "@haibun/core/schema/protocol.js";

export const provenanceOf = ({ in: line, seqPath, action }: TFeatureStep): TProvenanceIdentifier => ({
	in: line,
	seq: seqPath,
	when: `${action.stepperName}.steps.${action.actionName}`,
});
