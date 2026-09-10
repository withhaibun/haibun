/**
 * RPC response cache key format: the single source of truth shared by the live server (which writes the cache)
 * and the offline browser cache (which reads it), so the two must agree byte-for-byte. Pure: safe in the browser bundle.
 */

/** Cache key for an RPC call: the bare method name when there are no params, else `method:JSON.stringify(params)`. */
export function rpcCacheKey(method: string, params: Record<string, unknown>): string {
	return Object.keys(params).length === 0 ? method : `${method}:${JSON.stringify(params)}`;
}

/** Method portion of a key (everything before the first `:`); the whole key when it carries no params. */
export function rpcCacheKeyMethod(key: string): string {
	const i = key.indexOf(":");
	return i === -1 ? key : key.slice(0, i);
}

/** Params portion of a key, parsed back to its object; undefined for a bare (no-params) key. */
export function rpcCacheKeyParams(key: string): Record<string, unknown> | undefined {
	const i = key.indexOf(":");
	return i === -1 ? undefined : (JSON.parse(key.slice(i + 1)) as Record<string, unknown>);
}
