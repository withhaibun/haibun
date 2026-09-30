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
