/**
 * A statement's derivation from the records its proof wrote: the records under the statement's record in the order of their
 * paths, the calls among them, and the line of the first goal its proof couldn't prove.
 */
import { compareSeqPath, parseRecordName, SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { VERDICT, type TVerdict } from "@haibun/core/lib/domains/protocol.js";
import { DerivationSchema, type TDerivation } from "../domains/logic.js";

type TRecord = Record<string, unknown>;

const text = (record: TRecord, field: string): string | undefined => (typeof record[field] === "string" ? (record[field] as string) : undefined);
const pathOf = (record: TRecord): number[] => {
	const name = parseRecordName(String(record[SEQ_PATH_FIELD.id]));
	if (name === undefined) throw new Error(`the record ${String(record[SEQ_PATH_FIELD.id])} doesn't name a step of an execution`);
	return name.path;
};
const verdictOf = (record: TRecord): TVerdict | undefined => {
	const verdict = record[SEQ_PATH_FIELD.verdict];
	return Object.values(VERDICT).find((one) => one === verdict);
};

/** The goal that determined a record's verdict: the last part under it that isn't proved, followed down to a part whose own parts
 *  all hold, or the record itself. */
function firstUnmetOf(record: TRecord, under: TRecord[]): TRecord {
	const id = String(record[SEQ_PATH_FIELD.id]);
	const unmet = under.filter((part) => part[SEQ_PATH_EDGE.isPartOf] === id && verdictOf(part) !== VERDICT.proved).at(-1);
	return unmet === undefined ? record : firstUnmetOf(unmet, under);
}

/** The derivation of the statement whose record is `rootId`, from an execution's records. `isNode` states whether a record
 *  is of a node of a proof, such as a negation or a waypoint, and not of a call. */
export function derivationOf(records: TRecord[], rootId: string, isNode: (called: string | undefined) => boolean): TDerivation {
	const under = records
		.filter((record) => {
			const id = String(record[SEQ_PATH_FIELD.id]);
			return id === rootId || id.startsWith(`${rootId}.`);
		})
		.sort((a, b) => compareSeqPath(pathOf(a), pathOf(b)));
	const root = under.find((record) => record[SEQ_PATH_FIELD.id] === rootId);
	if (root === undefined) throw new Error(`the records don't hold ${rootId}, the record of the statement whose derivation was requested`);
	const verdict = verdictOf(root);
	if (verdict === undefined) throw new Error(`the record ${rootId} doesn't state a verdict; its proof didn't end`);
	const calls = under
		.filter((record) => !isNode(text(record, SEQ_PATH_FIELD.called)))
		.map((record) => ({
			path: String(record[SEQ_PATH_FIELD.id]),
			stepText: String(record[SEQ_PATH_FIELD.stepText]),
			called: text(record, SEQ_PATH_FIELD.called),
			verdict: verdictOf(record),
			allowedAction: text(record, SEQ_PATH_FIELD.allowedAction),
			capabilityAction: text(record, SEQ_PATH_FIELD.capabilityAction),
			error: text(record, SEQ_PATH_FIELD.error),
		}));
	const firstUnmet = verdict === VERDICT.proved ? undefined : text(firstUnmetOf(root, under), SEQ_PATH_FIELD.stepText);
	return DerivationSchema.parse({ verdict, records: under, calls, ...(firstUnmet === undefined ? {} : { firstUnmet }) });
}
