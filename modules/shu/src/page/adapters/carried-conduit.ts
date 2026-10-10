/**
 * The conduit of a page that carries a record of actuality. A site doesn't serve the page, so each call fails as a call to a
 * site that doesn't respond, and each read reads what the page carries.
 */
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import type { TConduit } from "../ports.js";

/** Why a call of a carried page fails. */
const NOT_SERVED = new Error("a page that carries a record of actuality isn't served by a site");

/** Returns the conduit of a page that carries a record of actuality. */
export function carriedConduit(): TConduit {
	const refuse = (method: string): Promise<never> => Promise.reject(new ServerUnreachable(method, NOT_SERVED));
	const conduit: TConduit = { follow: (link) => refuse(link.method), followStream: (link) => refuse(link.method), group: () => refuse("a group of calls") };
	return conduit;
}
