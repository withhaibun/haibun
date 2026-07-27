/**
 * The sequence-diagram model shape: a set of participant actors and the ordered messages between them. Shared between
 * the fisheye's graph → sequence derivation (spopg `sequence-model.ts`, which reads artifact-mediated actor edges) and
 * any consumer that needs the same protocol read. Pure types, no renderer — the sequence is drawn in the fisheye.
 */
export type TSeqActor = { id: string; label: string };
/** call: a forward message; return: a reply. */
export type TSeqMessageKind = "call" | "return";
export type TSeqMessage = { from: string; to: string; label: string; kind?: TSeqMessageKind };
export type TSeqModel = { actors: TSeqActor[]; messages: TSeqMessage[] };
