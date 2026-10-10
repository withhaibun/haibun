/** The addresses the monitor serves its page and its report at, in the form every hash of the page takes. */
import { SHU_TAG } from "../domains/elements.js";
import { hashOf, hashWithColumns } from "../page/derivations/address.js";

/** The hash parameter that names the type a graph query reads. */
const LABEL_PARAM = "label";

/** What the monitor's page shows a reader who arrives without an address: the monitor, beside the executions this device
 *  holds, where the reader opens an earlier feature. */
export const MONITOR_OPENS_AT = hashWithColumns([SHU_TAG.MONITOR_COLUMN, SHU_TAG.CLIENT_CACHE_COLUMN]);

/** Returns the hash the report opens at: the query of the type a graph query read, or undefined where actuality didn't run
 *  a graph query. */
export const reportOpensAt = (queriedLabel: string | undefined): string | undefined =>
	queriedLabel === undefined ? undefined : hashOf(new URLSearchParams({ [LABEL_PARAM]: queriedLabel }));
