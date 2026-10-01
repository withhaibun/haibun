/**
 * HTTP basic auth as haibun states it: the people a web server admits, named `user:password`, and the header a caller
 * signs in to it with.
 */
import { MODULE_OPTION_PREFIX } from "../schema/protocol.js";

/** A person a server admits by HTTP basic auth. */
export type TBasicAuthUser = { username: string; password: string };

/** The web server's option naming the people its basic auth admits, which an instance a run launches inherits from it. */
export const BASIC_AUTH_OPTION = `${MODULE_OPTION_PREFIX}WEBSERVERSTEPPER_BASIC_AUTH`;

/** The people a `user:password` list names, comma-separated. A malformed entry is refused, naming its position and not its text. */
export function basicAuthUsers(listed: string): TBasicAuthUser[] {
	return listed.split(",").map((entry, at) => {
		const colon = entry.indexOf(":");
		const [username, password] = [entry.slice(0, colon).trim(), entry.slice(colon + 1)];
		if (colon < 1 || password.length === 0) throw new Error(`basic auth entry ${at + 1} isn't user:password`);
		return { username, password };
	});
}

/** The `Authorization` value that signs in to basic auth as `user`. */
export const basicAuthorization = ({ username, password }: TBasicAuthUser): string => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`;
