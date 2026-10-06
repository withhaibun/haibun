/**
 * JSON-LD document loader and processor for haibun core. A conformant JSON-LD processor (jsonld) plus a document loader
 * that resolves @context, DID and key documents from what this process registered, and never from the network: a
 * document a caller presents names its own vocabulary, keys and controllers, so resolving an address it wrote would let
 * it choose what answers for its own proof. An unregistered URL throws.
 *
 * Two registries: long-lived `contexts` (bundled vocabulary @context documents, registered once) and ephemeral
 * `keyDocuments` (per-operation DID / key documents, cleared between operations). documentLoader tries keys, then
 * contexts.
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

/** Register a long-lived @context (or other vocabulary document) resolved by URL from memory. */
export function registerContext(url: string, document: unknown): void {
	contexts.set(url, document);
}

/** Register an ephemeral per-operation document (a DID document, a verification key) resolved by URL from memory. */
export function registerKeyDocument(url: string, document: unknown): void {
	keyDocuments.set(url, document);
}

/** Drop the ephemeral key documents; the long-lived contexts are kept. */
export function clearKeyDocuments(): void {
	keyDocuments.clear();
}

/** What this process holds for a URL: a key document, then a registered context. An unregistered URL throws. */
export function documentLoader(url: string): Promise<LoaderResult> {
	const held = keyDocuments.get(url) ?? contexts.get(url);
	if (held === undefined) return Promise.reject(new Error(`a JSON-LD document for ${url} isn't registered`));
	return Promise.resolve({ contextUrl: null, documentUrl: url, document: held });
}

/** The jsonld processor (expand / compact / toRDF / processContext), resolving external references through documentLoader. */
export { jsonld };
