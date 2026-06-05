/** RPC response cache: hydrated from embedded data in offline mode, queried by partial method name. */

const cache = new Map<string, unknown>();

/** Find a cached method by partial name (e.g., "graphQuery" matches "MonitorStepper-graphQuery"). */
export function findCachedMethod(name: string): string | undefined {
	for (const key of cache.keys()) {
		const method = key.split(":")[0];
		if (method === name || method.endsWith(`-${name}`)) return method;
	}
	return undefined;
}

/** Populate the cache from hydrated data (offline mode). */
export function setRpcCache(data: Record<string, unknown>): void {
	cache.clear();
	for (const [k, v] of Object.entries(data)) cache.set(k, v);
}
