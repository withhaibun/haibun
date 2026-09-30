// Re-export Hono auth middleware for consumers
export { basicAuth } from "hono/basic-auth";
export { bearerAuth } from "hono/bearer-auth";

/** A person a server admits by HTTP basic auth. */
export type TBasicAuthUser = { username: string; password: string };

/** The people a `user:password` list names, comma-separated. A malformed entry is refused, naming its position and not its text. */
export function basicAuthUsers(listed: string): TBasicAuthUser[] {
	return listed.split(",").map((entry, at) => {
		const colon = entry.indexOf(":");
		const [username, password] = [entry.slice(0, colon).trim(), entry.slice(colon + 1)];
		if (colon < 1 || password.length === 0) throw new Error(`basic auth entry ${at + 1} isn't user:password`);
		return { username, password };
	});
}

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
