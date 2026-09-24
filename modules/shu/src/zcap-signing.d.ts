/**
 * The parts of the zcap-LD signing libraries a page uses to delegate, declared because the packages publish no types:
 * the library's shape is stated once, where a reader can check it against the library.
 */
type TSigningDocument = Record<string, unknown>;
type TSigningLoaderResult = { contextUrl: string | null; documentUrl: string; document: unknown };
type TSigningDocumentLoader = (url: string) => Promise<TSigningLoaderResult>;

declare module "@digitalbazaar/zcap" {
	/** The vocabulary a capability document is written in. */
	export const constants: { ZCAP_CONTEXT_URL: string };
	/** A loader that answers the zcap context from the library itself, and everything else from the loader it wraps. */
	export function extendDocumentLoader(documentLoader: TSigningDocumentLoader): TSigningDocumentLoader;
	/** The proof purpose a delegation is signed under, naming the capability it narrows. */
	export class CapabilityDelegation {
		constructor(options: { parentCapability: string | TSigningDocument; allowTargetAttenuation?: boolean });
	}
}

declare module "jsonld-signatures" {
	const jsigs: { sign(document: TSigningDocument, options: { suite: unknown; purpose: unknown; documentLoader: TSigningDocumentLoader }): Promise<TSigningDocument> };
	export default jsigs;
}

declare module "@digitalbazaar/data-integrity" {
	/** A proof made by a signer, over a document canonicalised by the cryptosuite. */
	export class DataIntegrityProof {
		constructor(options: { signer: { id: string; algorithm: string; sign(options: { data: Uint8Array }): Promise<Uint8Array> }; cryptosuite: unknown });
	}
}

declare module "@digitalbazaar/ecdsa-rdfc-2019-cryptosuite" {
	export const cryptosuite: unknown;
}

declare module "@digitalbazaar/zcap-context" {
	export const contexts: Map<string, unknown>;
}
declare module "@digitalbazaar/data-integrity-context" {
	export const contexts: Map<string, unknown>;
}
declare module "@digitalbazaar/security-context" {
	export const contexts: Map<string, unknown>;
}
declare module "@digitalbazaar/multikey-context" {
	export const contexts: Map<string, unknown>;
}
declare module "did-context" {
	export const contexts: Map<string, unknown>;
}
