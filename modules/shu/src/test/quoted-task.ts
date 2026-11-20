/**
 * A test site's Task t1, whose title the Body b1 quotes in a passage a step extracted: the Task cites the passage as evidence of its
 * value, and the passage names its quote by its selector, its source and the step that generated it.
 */
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { counted } from "@haibun/core/lib/domains/hypermedia.js";
import { BODY_DIGEST, BODY_LABEL, EVIDENCE_EDGE, LinkRelations, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL } from "@haibun/core/lib/domains/resources.js";
import { EARL_ASSERTION_EDGE, EARL_LABEL } from "@haibun/core/lib/domains/earl.js";
import type { TCatalogSpec } from "./catalog-fixture.js";

/** The passage of the Body b1 that quotes the Task's title. */
export const QUOTE = { exact: "a task", prefix: "the title is ", suffix: " today" };
/** The step that extracted the passage. */
export const EXTRACTING_STEP = "1795000000000-1.0.1";

/** The digest of the Body b1 as the site holds it. */
export const B1_DIGEST = "the digest of b1";

/** Returns the read of the Task t1, of its passage or of the Body b1, as the site returns a record with its edges, where the passage
 *  states `stated` as the digest of b1 it quoted: b1's digest for a current passage, and another for a stale one. */
export const quotedTaskReads = (stated: string) => (params: Record<string, unknown>) =>
	params.label === SPECIFIC_RESOURCE_LABEL
		? {
				vertex: { "@id": heldRecordIri(SPECIFIC_RESOURCE_LABEL, "sr1"), [LinkRelations.SOURCE_DIGEST.rel]: stated },
				edges: [
					{ type: LinkRelations.HAS_SELECTOR.rel, direction: "out", target: QUOTE },
					{ type: LinkRelations.HAS_SOURCE.rel, direction: "out", target: { "@id": heldRecordIri(BODY_LABEL, "b1"), "@type": BODY_LABEL } },
					{ type: LinkRelations.WAS_GENERATED_BY.rel, direction: "out", target: { "@id": heldRecordIri(SEQ_PATH_LABEL, EXTRACTING_STEP) } },
				],
				incomingCount: counted(0),
			}
		: params.label === BODY_LABEL
			? { vertex: { "@id": heldRecordIri(BODY_LABEL, "b1"), id: "b1", [BODY_DIGEST]: B1_DIGEST }, edges: [], incomingCount: counted(0) }
			: {
					vertex: { "@id": heldRecordIri("Task", "t1"), title: QUOTE.exact, status: "open" },
					edges: [{ type: EVIDENCE_EDGE.rel, direction: "out", target: { "@id": heldRecordIri(SPECIFIC_RESOURCE_LABEL, "sr1") } }],
					incomingCount: counted(0),
				};

/** The reads of a site whose passage quotes the Body b1 as it reads. */
export const quotedTaskEntity = quotedTaskReads(B1_DIGEST);

/** The catalog of the Task, its passage's types and its claims' assertions: the Task's evidence edge reaches its passages, and an
 *  assertion's edge to the step that made it reaches the step's record. */
export const QUOTED_TASK_SPEC: TCatalogSpec = {
	types: ["Task", BODY_LABEL, SPECIFIC_RESOURCE_LABEL, SEQ_PATH_LABEL, EARL_LABEL.assertion],
	edgeRanges: { Task: { [EVIDENCE_EDGE.rel]: [SPECIFIC_RESOURCE_LABEL] }, [EARL_LABEL.assertion]: { [EARL_ASSERTION_EDGE.wasGeneratedBy]: [SEQ_PATH_LABEL] } },
};
