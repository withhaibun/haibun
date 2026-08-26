/** RPC response cache: hydrated from embedded data in offline mode, queried by partial method name. */
import { rpcCacheKey, rpcCacheKeyMethod } from "@haibun/core/lib/rpc-cache-key.js";

const cache = new Map<string, unknown>();

/** Find a cached method by partial name (e.g., "graphQuery" matches "MonitorStepper-graphQuery"). */
export function findCachedMethod(name: string): string | undefined {
	for (const key of cache.keys()) {
		const method = rpcCacheKeyMethod(key);
		if (method === name || method.endsWith(`-${name}`)) return method;
	}
	return undefined;
}

/** Look up a captured RPC response by (method, params); `rpcCacheKey` is the same key the live server wrote in `cacheRpcResponse`. */
export function getCachedResponse(method: string, params: Record<string, unknown>): { found: boolean; value: unknown } {
	const key = rpcCacheKey(method, params);
	if (cache.has(key)) return { found: true, value: cache.get(key) };
	return { found: false, value: undefined };
}

/** Populate the cache from hydrated data (offline mode). */
export function setRpcCache(data: Record<string, unknown>): void {
	cache.clear();
	for (const [k, v] of Object.entries(data)) cache.set(k, v);
}
