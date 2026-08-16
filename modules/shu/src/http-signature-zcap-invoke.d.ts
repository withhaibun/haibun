/**
 * The part of the ZCAP-LD HTTP binding a reader's page uses, declared because the package publishes no types: a caller
 * signs the request it is making, so the proof covers what is asked and of what.
 */
declare module "@digitalbazaar/http-signature-zcap-invoke" {
	type TDocument = Record<string, unknown>;
	/** Signs the request's own headers, so the proof covers what is asked and of what rather than a document beside it. */
	export function signCapabilityInvocation(options: {
		url: string;
		method: string;
		headers: Record<string, string | undefined>;
		json?: unknown;
		body?: string;
		capability?: string | TDocument;
		capabilityAction: string;
		invocationSigner: { id: string; algorithm?: string; sign(options: { data: Uint8Array }): Promise<Uint8Array> };
		created?: number;
		expires?: number;
	}): Promise<Record<string, string>>;
}
