/**
 * What the actions bar works out, apart from how it draws it: what the current selection is called. It is arithmetic over
 * values the bar already holds, so it can be read and tested without a browser, as `petitions-model.ts` is to its panel.
 */

import { NOTHING_SELECTED_LABEL, type TContextPattern, type TContextIndividual } from "../schemas.js";
import { DENOTES } from "@haibun/core/lib/typed-links.js";

/** What the bar knows about the view behind the selection, for when the patterns do not name one. */
export type TContextExtra = { total?: number; label?: string; folder?: string };

/** Every pattern names a record: the reader has records selected, not a type to query over. */
export function isEntitySelection(patterns: TContextPattern[]): patterns is TContextIndividual[] {
	return patterns.length > 0 && patterns.every((p) => p.kind === DENOTES.individual);
}

/**
 * What to call the current context: one selected record by its own name, several by their count, and a type by what
 * the view behind it holds, and `NOTHING_SELECTED_LABEL` when nothing is selected.
 */
export function contextLabel(patterns: TContextPattern[], extra?: TContextExtra): string {
	if (patterns.length === 0) return NOTHING_SELECTED_LABEL;
	if (isEntitySelection(patterns)) return patterns.length === 1 ? patterns[0].id : `${patterns.length} items`;
	const parts: string[] = [`${extra?.label || patterns.find((p) => p.kind === DENOTES.type)?.persistedAs}:`];
	if (extra?.total !== undefined) parts.push(String(extra.total));
	if (extra?.folder) parts.push(`in ${extra.folder}`);
	return parts.join(" ");
}
