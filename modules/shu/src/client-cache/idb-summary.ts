/**
 * What IndexedDB caches for this origin, as reported to a reader: each database, each of its object stores and
 * how many records are in it. Read-only, and nothing where there is no IndexedDB (a test, a context without it).
 */
export type TIdbStoreSummary = { name: string; count: number };
export type TIdbDatabaseSummary = { name: string; version: number; stores: TIdbStoreSummary[] };

const request = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

export async function indexedDbSummary(): Promise<TIdbDatabaseSummary[]> {
	const idb = (globalThis as { indexedDB?: IDBFactory & { databases?: () => Promise<Array<{ name?: string; version?: number }>> } }).indexedDB;
	if (!idb?.databases) return [];
	const out: TIdbDatabaseSummary[] = [];
	for (const { name } of await idb.databases()) {
		if (!name) continue;
		const db = await request(idb.open(name)); // the current version: an open without a version never upgrades
		try {
			const names = Array.from(db.objectStoreNames);
			const stores: TIdbStoreSummary[] = [];
			if (names.length > 0) {
				const tx = db.transaction(names, "readonly");
				for (const storeName of names) stores.push({ name: storeName, count: await request(tx.objectStore(storeName).count()) });
			}
			out.push({ name, version: db.version, stores });
		} finally {
			db.close();
		}
	}
	return out;
}
