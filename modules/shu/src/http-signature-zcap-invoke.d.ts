/**
 * The part of the ZCAP-LD HTTP binding a reader's page uses, declared because the package publishes no types and only
 * as far as this module calls it. The consumer's own declaration (its zcap.d.ts) states the library's fuller surface.
 */
declare module "@digitalbazaar/http-signature-zcap-invoke" {
	/** Signs the request's own headers, so the proof covers what is asked and of what rather than a document beside it.
	 *  `body` is the request body exactly as it will be sent, so the digest the signature covers is over those bytes. */
	export function signCapabilityInvocation(options: {
		url: string;
		method: string;
		headers: Record<string, string | undefined>;
		body: string;
		capability: Record<string, unknown>;
		capabilityAction: string;
		invocationSigner: { id: string; sign(options: { data: Uint8Array }): Promise<Uint8Array> };
	}): Promise<Record<string, string>>;
}
