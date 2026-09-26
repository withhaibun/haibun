/**
 * What a page holds, as a view that reads its authority meets it in a test. `read` answers the authority given, and it
 * doesn't ask a server. This is the one fake for the authority boundary, and every view's test that reads it shares it.
 */
import { vi } from "vitest";
import { AuthorityController, type TAuthority } from "./authority-controller.js";

/** A page that doesn't hold an action or read a principal. */
export const EMPTY_AUTHORITY: TAuthority = { holds: [], grantedBy: {}, principals: [] };

/** Make every view's authority read answer `authority`. */
export function pageHolding(authority: TAuthority = EMPTY_AUTHORITY): void {
	vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(authority);
}

/** Make every view's authority read fail with `error`. */
export function pageAuthorityFails(error: Error): void {
	vi.spyOn(AuthorityController.prototype, "read").mockRejectedValue(error);
}
