/** RPC response cache — shared between SseClient (browser) and MonitorStepper (server). */

const MAX_CACHE = 1000;
const cache = new Map<string, unknown>();

export function cacheKey(method: string, params: Record<string, unknown>): string {
	return Object.keys(params).length === 0 ? method : `${method}:${JSON.stringify(params)}`;
}

export function cacheGet(key: string): unknown | undefined {
	return cache.get(key);
}

export function cacheSet(key: string, value: unknown): void {
	if (cache.size >= MAX_CACHE) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, value);
}

export function cacheHas(key: string): boolean {
	return cache.has(key);
}

/** Find a cached method by partial name (e.g., "graphQuery" matches "MonitorStepper-graphQuery"). */
export function findCachedMethod(name: string): string | undefined {
	for (const key of cache.keys()) {
		const method = key.split(":")[0];
		if (method === name || method.endsWith(`-${name}`)) return method;
	}
	return undefined;
}

/** Get the serializable cache for embedding in standalone HTML. */
export function getRpcCache(): Record<string, unknown> {
	return Object.fromEntries(cache);
}

/** Populate the cache from hydrated data (offline mode). */
export function setRpcCache(data: Record<string, unknown>): void {
	cache.clear();
	for (const [k, v] of Object.entries(data)) cache.set(k, v);
}
