/**
 * Declares the part of the ZCAP-LD HTTP binding that a reader's page calls, because the package doesn't publish types.
 * The declaration covers only the calls page-key.ts makes. The consumer's own declaration (its zcap.d.ts) states more of
 * the library's surface.
 */
declare module "@digitalbazaar/http-signature-zcap-invoke" {
	/** Signs the request's own headers, so the proof covers the invoked action and the request target instead of a
	 *  separate document. `body` is the request body as it will be sent, so the signed digest covers those bytes. A
	 *  request without a body, such as a GET, doesn't carry a digest. */
	export function signCapabilityInvocation(options: {
		url: string;
		method: string;
		headers: Record<string, string | undefined>;
		body?: string;
		/** A delegated capability or a root capability's id. Where absent, the library invokes the root capability of `url`. */
		capability?: Record<string, unknown> | string;
		capabilityAction: string;
		invocationSigner: { id: string; sign(options: { data: Uint8Array<ArrayBuffer> }): Promise<Uint8Array> };
	}): Promise<Record<string, string>>;
}
