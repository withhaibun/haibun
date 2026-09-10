/**
 * What already answers on a port, in words an operator can act on, or nothing, when the port is free to take.
 *
 * Raw fetch rather than the RPC client: a refused connection means the port is free, while ANY answer: the handshake
 * every remote surface begins with, or something that cannot even speak JSON, means it is held, and the client's
 * retry layer reads the second case as the first. One home for the probe, so a supervisor refusing a run's port and a
 * web server explaining a failed bind describe the occupant the same way.
 */

import { rpcEnvelope } from "./rpc-wire.js";

const PROBE_TIMEOUT_MS = 1_500;

export async function describePortOccupant(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | undefined> {
	let res: Response;
	try {
		res = await fetch(`http://localhost:${port}/rpc/${encodeURIComponent("action.begin")}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: rpcEnvelope({ id: "port-probe", method: "action.begin", params: {}, seqPath: [] }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch {
		return undefined; // nothing connected: the port is free to take
	}
	const body = (await res.json().catch((): undefined => undefined)) as { hostId?: number } | undefined;
	if (res.ok && body) return `a haibun host${body.hostId !== undefined ? ` (id ${body.hostId})` : ""} answers there, likely a run or serve left standing from an earlier session`;
	return `something that is not a haibun host answers there (HTTP ${res.status})`;
}
