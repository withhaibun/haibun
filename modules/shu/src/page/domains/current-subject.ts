/**
 * The records the page activates and the scopes that activate them: a record, the entry a scope holds, and the entry a set
 * of context patterns names.
 */
import type { AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import { DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import type { TBundle, TPageContext } from "../../domains/schemas.js";
import type { TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";

/** A record: what a pane shows, or a comment of a conversation. */
export type TRecord = { id: string; label: string };

/** The record an individual's address names. */
export const recordOf = ({ persistedAs, id }: { persistedAs: string; id: string }): TRecord => ({ id, label: persistedAs });

/** What a scope has active. An entry without a record is a scope whose reader didn't choose a record, or chose a type. */
export type TEntry = { record: TRecord | null; turn?: string; bundle: TBundle };

/** The scopes that activate records on this page. */
export const SCOPE = { page: "page", actionsBar: "actions-bar" } as const;

/** The entry for a set of context patterns: the record the first of them names, where it names one, with the patterns
 *  as its bundle. A type doesn't name a record. */
/** The entry a view's stated context names. */
export const entryOfContext = (context: TPageContext): TEntry => entryOf(context.patterns, context.readLevel);

export function entryOf(patterns: TContextPattern[], accessLevel: AccessQueryLevel): TEntry {
	const first = patterns[0];
	const record = first && first.kind === DENOTES.individual ? recordOf(first) : null;
	return { record, bundle: { patterns, accessLevel } };
}
