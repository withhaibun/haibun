/**
 * A test site's Task t1, whose title the Body b1 quotes in a passage a step extracted: the Task cites the passage as evidence of its
 * value, and the passage names its quote by its selector, its source and the step that generated it.
 */
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { counted } from "@haibun/core/lib/domains/hypermedia.js";
import { EVIDENCE_EDGE, LinkRelations, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL } from "@haibun/core/lib/domains/resources.js";
import { EARL_ASSERTION_EDGE, EARL_LABEL } from "@haibun/core/lib/domains/earl.js";
import type { TCatalogSpec } from "./catalog-fixture.js";

/** The passage of the Body b1 that quotes the Task's title. */
export const QUOTE = { exact: "a task", prefix: "the title is ", suffix: " today" };
/** The step that extracted the passage. */
export const EXTRACTING_STEP = "1795000000000-1.0.1";

/** The read of the Task t1 or of its passage, as the site returns a record with its edges. */
export const quotedTaskEntity = (params: Record<string, unknown>) =>
	params.label === SPECIFIC_RESOURCE_LABEL
		? {
				vertex: { "@id": heldRecordIri(SPECIFIC_RESOURCE_LABEL, "sr1") },
				edges: [
					{ type: LinkRelations.HAS_SELECTOR.rel, direction: "out", target: QUOTE },
					{ type: LinkRelations.HAS_SOURCE.rel, direction: "out", target: { "@id": heldRecordIri("Body", "b1"), "@type": "Body" } },
					{ type: LinkRelations.WAS_GENERATED_BY.rel, direction: "out", target: { "@id": heldRecordIri(SEQ_PATH_LABEL, EXTRACTING_STEP) } },
				],
				incomingCount: counted(0),
			}
		: {
				vertex: { "@id": heldRecordIri("Task", "t1"), title: QUOTE.exact, status: "open" },
				edges: [{ type: EVIDENCE_EDGE.rel, direction: "out", target: { "@id": heldRecordIri(SPECIFIC_RESOURCE_LABEL, "sr1") } }],
				incomingCount: counted(0),
			};

/** The catalog of the Task, its passage's types and its claims' assertions: the Task's evidence edge reaches its passages, and an
 *  assertion's edge to the step that made it reaches the step's record. */
export const QUOTED_TASK_SPEC: TCatalogSpec = {
	types: ["Task", "Body", SPECIFIC_RESOURCE_LABEL, SEQ_PATH_LABEL, EARL_LABEL.assertion],
	edgeRanges: { Task: { [EVIDENCE_EDGE.rel]: [SPECIFIC_RESOURCE_LABEL] }, [EARL_LABEL.assertion]: { [EARL_ASSERTION_EDGE.wasGeneratedBy]: [SEQ_PATH_LABEL] } },
};
