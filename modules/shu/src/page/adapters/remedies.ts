/** The remedies the page performs itself: a reload, which reads actuality and the reader's authority again as the page starts. */
import type { TRemedies } from "../ports.js";

/** Returns the remedies of the page at `location`. */
export const browserRemedies = (location: Location): TRemedies => ({ reloadPage: () => location.reload() });
