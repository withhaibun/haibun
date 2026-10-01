// Re-export Hono auth middleware for consumers
export { basicAuth } from "hono/basic-auth";
export { bearerAuth } from "hono/bearer-auth";

/** The status a server answers a request that doesn't sign in with. */
const ASKS_TO_SIGN_IN = 401;

/**
 * Why `address` doesn't ask a visitor to sign in, or undefined where it does: a request that carries no sign-in is answered
 * 401. The message states what was found and what to change, since a failed check stops the actuality that made it.
 */
export async function whyNotSignedInOnly(
	address: string,
	request: (address: string) => Promise<Response> = (at) => fetch(at, { redirect: "manual" }),
): Promise<string | undefined> {
	let answer: Response;
	try {
		answer = await request(address);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		return `Couldn't check that ${address} asks visitors to sign in: ${reason}. Check the address and that its proxy is running.`;
	}
	if (answer.status === ASKS_TO_SIGN_IN) return undefined;
	return `${address} answered ${answer.status} without a sign-in; it must answer ${ASKS_TO_SIGN_IN}. Put basic auth on its proxy, or set the web server's BASIC_AUTH option.`;
}
