/**
 * What IndexedDB caches for this origin, as reported to a reader: each database, each of its object stores and
 * how many records are in it. Read-only, and empty where IndexedDB doesn't exist (a test, a context without it). Each
 * database's counts are one transaction, which commits as it issues them, so it doesn't wait on the page to take each count.
 */
export type TIdbStoreSummary = { name: string; count: number };
export type TIdbDatabaseSummary = { name: string; version: number; stores: TIdbStoreSummary[] };

const request = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** The count of each store `names` names, issued together in `tx`, which commits as it issues them. */
function countsOf(tx: IDBTransaction, names: string[]): Promise<TIdbStoreSummary[]> {
	const counts = names.map(async (name) => ({ name, count: await request(tx.objectStore(name).count()) }));
	tx.commit();
	return Promise.all(counts);
}

export async function indexedDbSummary(): Promise<TIdbDatabaseSummary[]> {
	const idb = (globalThis as { indexedDB?: IDBFactory & { databases?: () => Promise<Array<{ name?: string; version?: number }>> } }).indexedDB;
	if (!idb?.databases) return [];
	const out: TIdbDatabaseSummary[] = [];
	for (const { name } of await idb.databases()) {
		if (!name) continue;
		const db = await request(idb.open(name)); // the current version: an open without a version never upgrades
		try {
			const names = Array.from(db.objectStoreNames);
			out.push({ name, version: db.version, stores: names.length === 0 ? [] : await countsOf(db.transaction(names, "readonly"), names) });
		} finally {
			db.close();
		}
	}
	return out;
}
