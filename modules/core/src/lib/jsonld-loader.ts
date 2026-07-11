/**
 * JSON-LD document loader and processor for haibun core. A conformant JSON-LD processor (jsonld) plus a document loader
 * that resolves @context / DID / key documents from a local in-memory registry — no network on this path. Network
 * resolution is opt-in: a consumer that wants it registers a resolver via setNetworkResolver; absent one, an unresolved
 * URL throws rather than silently reaching out.
 *
 * Two registries: long-lived `contexts` (bundled vocabulary @context documents, registered once) and ephemeral
 * `keyDocuments` (per-operation DID / key documents, cleared between operations). documentLoader tries keys, then
 * contexts, then the network resolver.
 */
// @ts-expect-error — jsonld ships partial type declarations
import jsonld from "jsonld";

export interface LoaderResult {
	contextUrl: null;
	documentUrl: string;
	document: unknown;
}

/** Resolves a URL not held in the local registries. Injected by a consumer that opts in to network resolution. */
export type NetworkResolver = (url: string) => Promise<LoaderResult>;

const contexts = new Map<string, unknown>();
const keyDocuments = new Map<string, unknown>();
let networkResolver: NetworkResolver | undefined;

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

/** Opt in to network resolution for URLs absent from the registries. Pass undefined to disable it again. */
export function setNetworkResolver(resolver: NetworkResolver | undefined): void {
	networkResolver = resolver;
}

/** JSON-LD document loader: local key documents, then registered contexts, then the injected network resolver. With no
 *  resolver an unresolved URL throws — core never reaches the network implicitly. */
export async function documentLoader(url: string): Promise<LoaderResult> {
	const keyDoc = keyDocuments.get(url);
	if (keyDoc !== undefined) return { contextUrl: null, documentUrl: url, document: keyDoc };
	const ctx = contexts.get(url);
	if (ctx !== undefined) return { contextUrl: null, documentUrl: url, document: ctx };
	if (networkResolver) return await networkResolver(url);
	throw new Error(`No registered JSON-LD document for ${url}, and no network resolver is enabled`);
}

/** The jsonld processor (expand / compact / toRDF / processContext), resolving external references through documentLoader. */
export { jsonld };
