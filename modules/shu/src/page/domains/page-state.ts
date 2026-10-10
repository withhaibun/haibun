/** The page's state that its views share: the strip's panes, the docked pane and the types the page searches; and the
 *  details of the events its views send the page. */
import { z } from "zod";
import { SearchConditionSchema } from "@haibun/core/lib/quad-types.js";
import type { TComboboxOption } from "../../schemas.js";

/** A pane in the column strip: its key in the active pane, the label a breadcrumb names, whether it is the query pane, and
 *  whether it is docked along the bottom of the page or laid out as a column. */
export type TStripPane = { key: string; label: string; query: boolean; docked: boolean };

/** The pane docked along the bottom of the page: its key, and whether it is open. */
export type TDockedPane = { key: string; open: boolean };

/** The types the page searches: what each is called, and the one the search reads now. */
export type TPageTypes = { options: ReadonlyArray<TComboboxOption>; selected: string };

/** A search a view sets for the page's query: whether a reader asked for it, and its access level, type and conditions,
 *  each where the view states it. */
export const FilterChangeSchema = z
	.object({ asked: z.boolean(), accessLevel: z.string().optional(), label: z.string().optional(), textQuery: z.string().optional(), conditions: z.array(SearchConditionSchema).optional() })
	.strict();

/** A breadcrumb a reader followed: the index of the pane it names. */
export const BreadcrumbNavSchema = z.object({ index: z.number().int().nonnegative() });
