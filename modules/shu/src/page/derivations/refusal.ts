/** A failure as the page's refusal (CA4F4): the site's refusal as the site stated it, a read again where the page didn't
 *  reach the site, and any other failure's cause without a remedy. */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { isServerUnreachable, refusalCarried } from "@haibun/core/lib/rpc-wire.js";
import { READ_AGAIN, type TPageRefusal } from "../domains/refusal.js";

/** Returns the refusal `err` states. */
export function refusalOf(err: unknown): TPageRefusal {
	const carried = refusalCarried(err);
	if (carried !== undefined) return carried;
	return isServerUnreachable(err) ? { error: errorDetail(err), remedy: READ_AGAIN } : { error: errorDetail(err) };
}
