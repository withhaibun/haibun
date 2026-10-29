/**
 * The page's key store: an ECDSA P-256 key pair the browser keeps in IndexedDB, whose private half isn't readable, so the
 * key outlasts a reload and a delegation to it holds. The store keeps what the page keeps beside its key.
 */
import { z } from "zod";
import type { TKeyPair, TKeyStore } from "../ports.js";

const KEY_DB = "haibun-page-key";
const KEY_STORE = "keys";
const PAGE_KEY = "page";
/** The key pair as IndexedDB gives it back: the browser's own keys, structured-cloned. */
const KeyPairSchema = z.object({ publicKey: z.instanceof(CryptoKey), privateKey: z.instanceof(CryptoKey) }) satisfies z.ZodType<CryptoKeyPair>;

/** Returns the key store of the page, or of the browser extension's worker. Each call reads the context's `crypto.subtle`
 *  and `indexedDB`, which a browser holds in a secure context, and throws where the context doesn't hold either, and names
 *  the remedy. */
export function browserKeyStore(): TKeyStore {
	const held = (): { subtle: SubtleCrypto; indexedDB: IDBFactory } => {
		const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
		const indexedDB: IDBFactory | undefined = globalThis.indexedDB;
		const origin: string | undefined = globalThis.location?.origin;
		if (subtle === undefined)
			throw new Error(
				`a reader makes a key only in a secure context (https, or localhost); this page runs at ${origin === undefined ? "a context without a location" : origin}, where the browser withholds its key store`,
			);
		if (indexedDB === undefined) throw new Error("a reader's page keeps its key in the browser's IndexedDB, which this page doesn't hold");
		return { subtle, indexedDB };
	};
	const request = <T>(asked: IDBRequest<T>): Promise<T> =>
		new Promise((resolve, reject) => {
			asked.onsuccess = () => resolve(asked.result);
			asked.onerror = () => reject(asked.error);
		});
	// The connection closes once used, since what it read is usable without it, and a connection the page holds open slows
	// each other store it reads.
	const withDb = async <T>(use: (db: IDBDatabase) => Promise<T>): Promise<T> => {
		const opening = held().indexedDB.open(KEY_DB, 1);
		opening.onupgradeneeded = () => opening.result.createObjectStore(KEY_STORE);
		const db = await request(opening);
		try {
			return await use(db);
		} finally {
			db.close();
		}
	};
	const read = (name: string): Promise<unknown> => withDb((db) => request(db.transaction(KEY_STORE).objectStore(KEY_STORE).get(name)));
	const keep = async (name: string, value: unknown): Promise<void> => {
		await withDb((db) => request(db.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE).put(value, name)));
	};
	const keptPair = async (): Promise<CryptoKeyPair> => {
		const kept = await read(PAGE_KEY);
		if (kept !== undefined) return KeyPairSchema.parse(kept);
		const made = await held().subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
		await keep(PAGE_KEY, made);
		return made;
	};
	return {
		keyPair: async (): Promise<TKeyPair> => {
			const pair = await keptPair();
			const { subtle } = held();
			return {
				publicJwk: await subtle.exportKey("jwk", pair.publicKey),
				sign: async (data) => new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data)),
			};
		},
		read,
		keep,
	};
}
