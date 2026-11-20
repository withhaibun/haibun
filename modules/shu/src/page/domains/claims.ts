/**
 * The claims the reasoner made about a record, as the page reads them from the EARL assertions whose subject is the record, and the
 * passages a record cites as evidence of its values.
 */
import type { TClaimVerdict } from "@haibun/core/lib/records/domains/claim.js";
import type { TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";
import type { TRecordName } from "@haibun/core/lib/records/domains/unit.js";

/** The step that made a claim: its record, and the label by which a view names it. */
export type TClaimStep = TRecordName & { readonly title: string };

/** A claim about a record: the test's sentence, the field it is of where it is of one, the verdict its outcome states, its proof,
 *  and the step that made it. A record that steps wrote more than once holds the claims of each step. */
export type TRecordClaim = { readonly test: string; readonly field?: string; readonly verdict: TClaimVerdict; readonly proof: string; readonly madeBy: TClaimStep };

/** A passage a record cites as evidence of one of its values: the quote, the record whose text holds it, and the step that extracted
 *  it, where a step did. */
export type TEvidence = { readonly quote: TQuoteAnchor; readonly source: TRecordName; readonly extractedBy?: string };
