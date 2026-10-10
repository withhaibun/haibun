/** The page the embedding page posted, as a block of a turn's view. */
import type { TEmbeddedPageView } from "../../domains/embedding.js";

/** Returns `view` as the blocks of a turn's view: the posted page, or an empty list where the reader doesn't have a page
 *  open. */
export const embeddedViewLd = (view: TEmbeddedPageView | null): TEmbeddedPageView[] => (view === null ? [] : [view]);
