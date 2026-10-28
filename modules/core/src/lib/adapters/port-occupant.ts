/**
 * Describes the process that responds on a port, in words on which an operator can act. Returns undefined when the port is
 * free.
 *
 * The probe sends the ACTION_BEGIN handshake once with fetch. Every RPC client sends this handshake before its first
 * call. The probe treats a failed or timed-out request as a free port. A 2xx JSON response means a haibun host holds
 * the port. Any other response means another server holds it. The probe doesn't call the RPC client, because the client
 * retries a failed connection with backoff. The supervisor that refuses a run's port and the web server that reports a
 * failed bind both call this function, so both describe the occupant the same way.
 */

import { MEDIA_TYPE } from "../domains/media-types.js";
import { localOrigin } from "../domains/local-origin.js";
import { ACTION_BEGIN, RPC_ROUTE, rpcEnvelope } from "../transport/domains/rpc-wire.js";

/** How long a probe of a port is given to reply, in milliseconds. */
export const PROBE_TIMEOUT_MS = 1_500;

export async function describePortOccupant(port: number, timeoutMs: number): Promise<string | undefined> {
	let res: Response;
	try {
		res = await fetch(`${localOrigin(port)}${RPC_ROUTE}${encodeURIComponent(ACTION_BEGIN)}`, {
			method: "POST",
			headers: { "Content-Type": MEDIA_TYPE.json },
			body: rpcEnvelope({ id: "port-probe", method: ACTION_BEGIN, params: {}, seqPath: [] }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch {
		return undefined; // the request failed or timed out, so the probe reports the port as free
	}
	const body = (await res.json().catch((): undefined => undefined)) as { hostId?: number } | undefined;
	if (res.ok && body) return `a haibun host${body.hostId !== undefined ? ` (id ${body.hostId})` : ""} responds there, likely a standing run or serve from an earlier session`;
	return `a server that is not a haibun host responds there (HTTP ${res.status})`;
}
