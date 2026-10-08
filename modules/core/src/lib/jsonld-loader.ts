/**
 * JSON-LD document loader and processor for haibun core. This module exports a conformant JSON-LD processor (jsonld) and
 * a document loader. The loader resolves @context, DID and key documents from the documents this process registered. It
 * never fetches a document from the network. A document a caller presents names its own vocabulary, keys and
 * controllers. Fetching an address that document names would let the caller supply the documents that verify its own proof.
 * documentLoader rejects an unregistered URL.
 *
 * The module holds two registries. `contexts` holds long-lived vocabulary @context documents. `keyDocuments` holds
 * per-operation DID and key documents, and clearKeyDocuments clears them between operations. documentLoader reads
 * keyDocuments first, then contexts.
 */
// @ts-expect-error, jsonld ships partial type declarations
import jsonld from "jsonld";

interface LoaderResult {
	contextUrl: null;
	documentUrl: string;
	document: unknown;
}

const contexts = new Map<string, unknown>();
const keyDocuments = new Map<string, unknown>();

/** Registers a long-lived @context or other vocabulary document. documentLoader resolves it by URL from memory. */
export function registerContext(url: string, document: unknown): void {
	contexts.set(url, document);
}

/** Registers a per-operation DID document or verification key. documentLoader resolves it by URL from memory. */
export function registerKeyDocument(url: string, document: unknown): void {
	keyDocuments.set(url, document);
}

/** Clears the per-operation key documents. The long-lived contexts stay registered. */
export function clearKeyDocuments(): void {
	keyDocuments.clear();
}

/** Returns the key document registered for a URL, else the context registered for it. Rejects an unregistered URL. */
export function documentLoader(url: string): Promise<LoaderResult> {
	const held = keyDocuments.get(url) ?? contexts.get(url);
	if (held === undefined)
		return Promise.reject(new Error(`a JSON-LD document for ${url} isn't registered. Register it with registerContext or registerKeyDocument before loading it`));
	return Promise.resolve({ contextUrl: null, documentUrl: url, document: held });
}

/** The jsonld processor (expand, compact, toRDF, processContext). A caller passes documentLoader in its options to resolve external references. */
export { jsonld };
