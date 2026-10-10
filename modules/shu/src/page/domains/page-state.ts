/** The page's state that its views share: the strip's panes, the docked pane and the types the page searches. */
import type { TComboboxOption } from "../../schemas.js";

/** A pane in the column strip: its key in the active pane, the label a breadcrumb names, whether it is the query pane, and
 *  whether it is docked along the bottom of the page or laid out as a column. */
export type TStripPane = { key: string; label: string; query: boolean; docked: boolean };

/** The pane docked along the bottom of the page: its key, and whether it is open. */
export type TDockedPane = { key: string; open: boolean };

/** The types the page searches: what each is called, and the one the search reads now. */
export type TPageTypes = { options: ReadonlyArray<TComboboxOption>; selected: string };
