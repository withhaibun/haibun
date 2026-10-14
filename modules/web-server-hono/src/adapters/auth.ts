/**
 * HTTP sign-in at a server: Hono's basic and bearer middleware, which other packages mount as
 * `@haibun/web-server-hono/auth.js`, and the check that an address refuses a visitor that doesn't sign in.
 */
import type { TUnsignedRequest } from "../ports.js";

export { basicAuth } from "hono/basic-auth";
export { bearerAuth } from "hono/bearer-auth";

/** The status a server returns to a request that doesn't sign in. */
const ASKS_TO_SIGN_IN = 401;

/** Sends a request without a sign-in, and doesn't follow a redirect, so the address's own response is read. */
export const unsignedRequest: TUnsignedRequest = (address) => fetch(address, { redirect: "manual" });

/**
 * Why `address` doesn't require a visitor to sign in, or undefined where it does: a request without a sign-in
 * receives 401. The message states what was found and what to change, since a failed check stops the actuality that made it.
 */
export async function whyNotSignedInOnly(address: string, request: TUnsignedRequest): Promise<string | undefined> {
	let response: Response;
	try {
		response = await request(address);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		return `Couldn't check that ${address} requires visitors to sign in: ${reason}. Check the address and that its proxy is running.`;
	}
	if (response.status === ASKS_TO_SIGN_IN) return undefined;
	return `${address} returned ${response.status} without a sign-in; it must return ${ASKS_TO_SIGN_IN}. Put basic auth on its proxy, or set the web server's BASIC_AUTH option.`;
}
