/**
 * Where actuality holds its capability authority, and the reads of it: the authority, the authority an operation requires,
 * and the signer of a request to another host.
 */
import type { TRuntime } from "../actuality/domains/world.js";
import type { IAuthority, TRequestSigner } from "./authority-types.js";

export const AUTHORITY_KEY = "authority";

export function getAuthority(runtime: TRuntime): IAuthority | undefined {
	return runtime.keys?.[AUTHORITY_KEY] as IAuthority | undefined;
}

/** Returns actuality's authority. Throws where actuality doesn't hold one, and the error names `need` as the operation
 *  that requires it. */
export function heldAuthority(runtime: TRuntime, need: string): IAuthority {
	const authority = getAuthority(runtime);
	if (!authority) throw new Error(`actuality doesn't hold an authority, which ${need} requires`);
	return authority;
}

/** Returns the signer a client in this process uses for its requests to other hosts. The signer reads actuality's
 *  authority at each call, so a client created before the invoker's registration still signs with that invoker. */
export function requestSigner(runtime: TRuntime): TRequestSigner {
	return (request, action) => heldAuthority(runtime, `invoking ${action} at ${request.url}`).signRequest(request, action);
}
