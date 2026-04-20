/**
 * Discourse — closed set of speech acts a Comment can perform.
 *
 * Every Comment carries a required discourse tag distinguishing why it was
 * written. The set is deliberately small and closed; adding a value is a PR,
 * and each value carries a linked-data mapping note for reviewers and tools.
 *
 *   suggest  — schema:SuggestAction; proposing a change
 *   measure  — narration of a sosa:Observation
 *   report   — schema:Report / as:Announce
 *   narrate  — prose narration (no standard mapping)
 *   question — schema:Question; asking for clarification
 *   apply    — narration of a schema:UpdateAction (the Development is the act)
 *   revert   — narration of a schema:UpdateAction undoing a prior apply
 *   play     — rehearsal or try-out; prov:Activity with no side effects
 */
import { z } from "zod";

export const DISCOURSE = {
	suggest: "suggest",
	measure: "measure",
	report: "report",
	narrate: "narrate",
	question: "question",
	apply: "apply",
	revert: "revert",
	play: "play",
} as const;

const DISCOURSE_VALUES = Object.values(DISCOURSE) as [string, ...string[]];

export const DiscourseSchema = z.enum(DISCOURSE_VALUES, {
	message: `discourse must be one of ${DISCOURSE_VALUES.map((v) => `"${v}"`).join(", ")}`,
});

export type Discourse = z.infer<typeof DiscourseSchema>;
